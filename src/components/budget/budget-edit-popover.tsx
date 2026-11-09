"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBudgets, updateBudget, updateCategoryBudgetMode } from "@/lib/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useAccess } from "@/components/access-provider";

/**
 * Set or change a category's monthly budget from wherever the category shows
 * up (Budget, Home, Over time, Transactions), without a trip to Settings.
 * `trigger` is the element that opens it.
 */
export function BudgetEditPopover({
  categoryId,
  categoryName,
  amount,
  trigger,
  align = "end",
}: {
  categoryId: number;
  categoryName: string;
  /** Current monthly budget; 0 or null when there is none. */
  amount: number | null;
  trigger: ReactElement;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const { readOnly, ownerName } = useAccess();
  if (readOnly) {
    // A viewer sees the budget, can't set one: no "Set budget" prompts, and
    // an existing amount opens a note instead of the editor.
    if (!(amount != null && amount > 0)) return null;
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent align={align} className="w-64 p-3 text-sm">
          <div className="font-medium">
            {categoryName}: {formatCurrency(amount)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {ownerName ? `Only ${ownerName} can change budgets.` : "Only the owner can change budgets."}
          </p>
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} className="w-72 p-4">
        {/* Remounted on each open so the field starts from the saved amount. */}
        {open ? (
          <BudgetForm
            categoryId={categoryId}
            categoryName={categoryName}
            amount={amount}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same editor in a dialog, for places that start from a menu item rather
 * than a visible amount (a transaction's menu). Looks up the current budget.
 */
export function BudgetEditDialog({
  category,
  onClose,
}: {
  category: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const { data: budgets } = useQuery({
    queryKey: ["budgets"],
    queryFn: getBudgets,
    enabled: category !== null,
  });
  const amount = budgets?.find((b) => b.categoryId === category?.id)?.monthlyAmount ?? null;
  return (
    <Dialog open={category !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle className="sr-only">{category ? `${category.name} budget` : "Budget"}</DialogTitle>
        {category && budgets ? (
          <BudgetForm key={category.id} categoryId={category.id} categoryName={category.name} amount={amount} onDone={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BudgetForm({
  categoryId,
  categoryName,
  amount,
  onDone,
}: {
  categoryId: number;
  categoryName: string;
  amount: number | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const has = amount != null && amount > 0;
  const [draft, setDraft] = useState(has ? String(Math.round(amount * 100) / 100) : "");
  const [saving, setSaving] = useState(false);
  const parsed = draft.trim() === "" ? null : Number(draft);
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < 0);

  const save = async (next: number | null) => {
    setSaving(true);
    try {
      // A tracking-only category ignores its budget, so setting one budgets it.
      if (next != null && next > 0) await updateCategoryBudgetMode(categoryId, "budgeted");
      await updateBudget(categoryId, next != null && next > 0 ? next : null);
      void queryClient.invalidateQueries();
      toast.success(
        next != null && next > 0
          ? `${categoryName} budget set to ${formatCurrency(next)} a month`
          : `${categoryName} has no budget now`
      );
      onDone();
    } catch {
      toast.error("Couldn't save the budget.");
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) void save(parsed);
  };

  return (
    // Portaled, but React events still bubble to the page; keep clicks and keys
    // from reaching a clickable card underneath (which would open its sheet).
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="space-y-3"
    >
      <div>
        <div className="text-sm font-medium">
          <bdi>{categoryName}</bdi> budget
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">How much to spend on it each month.</p>
      </div>
      <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <span className="text-sm text-muted-foreground">₪</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          autoFocus
          value={draft}
          placeholder="No budget"
          aria-label={`Monthly budget for ${categoryName}`}
          aria-invalid={invalid}
          onChange={(e) => setDraft(e.target.value)}
          className={cn(
            "h-9 w-full min-w-0 bg-transparent text-sm tabular-nums outline-none placeholder:text-muted-foreground",
            invalid && "text-destructive"
          )}
        />
        <span className="shrink-0 text-xs text-muted-foreground">/ month</span>
      </label>
      <div className="flex items-center justify-between gap-2">
        {has ? (
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void save(null)}>
            Remove budget
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={saving || invalid}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
