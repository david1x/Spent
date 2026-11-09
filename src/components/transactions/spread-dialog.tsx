"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { TransactionWithCategory } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

/** Matches MAX_SPREAD_MONTHS in src/server/db/spend-view.ts. */
const MAX_MONTHS = 60;
const PRESETS = [3, 6, 12, 24];

/** A payment that may be counted over several months: not installments or transfers. */
export function canSpread(txn: TransactionWithCategory): boolean {
  return txn.type !== "installments" && txn.kind !== "transfer" && txn.chargedAmount !== 0;
}

/**
 * Count one payment over several months, for something paid up front (a year
 * of dog food, an annual insurance policy). Budgets and spending totals then
 * count an equal part each month from the month it was paid; the transaction
 * itself keeps the amount the bank charged.
 */
export function SpreadDialog({
  txn,
  onClose,
  onSave,
}: {
  txn: TransactionWithCategory | null;
  onClose: () => void;
  /** null counts it in full again. */
  onSave: (txn: TransactionWithCategory, months: number | null) => Promise<boolean>;
}) {
  const t = useTranslations("transactions.spread");
  return (
    <Dialog open={txn !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {txn ? <SpreadForm key={txn.id} txn={txn} onClose={onClose} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SpreadForm({
  txn,
  onClose,
  onSave,
}: {
  txn: TransactionWithCategory;
  onClose: () => void;
  onSave: (txn: TransactionWithCategory, months: number | null) => Promise<boolean>;
}) {
  const t = useTranslations("transactions.spread");
  const locale = useLocale() as Locale;
  const tag = locale === "he" ? "he-IL" : "en-IL";
  const saved = txn.spreadMonths ?? null;
  const [draft, setDraft] = useState(String(saved ?? 12));
  const [saving, setSaving] = useState(false);

  const months = draft.trim() === "" ? NaN : Number(draft);
  const valid = Number.isInteger(months) && months >= 2 && months <= MAX_MONTHS;
  const total = Math.abs(txn.chargedAmount);

  const paid = new Date(txn.date);
  const first = new Date(paid.getFullYear(), paid.getMonth(), 1);
  const last = valid ? new Date(paid.getFullYear(), paid.getMonth() + months - 1, 1) : null;
  const monthName = (d: Date) => d.toLocaleDateString(tag, { month: "short", year: "numeric" });

  const save = async (next: number | null) => {
    setSaving(true);
    const ok = await onSave(txn, next);
    setSaving(false);
    if (ok) onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (months === saved) return onClose();
    void save(months);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <bdi className="min-w-0 truncate text-[13px] font-medium" title={txn.description}>
            {txn.displayName || txn.description}
          </bdi>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {paid.toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
            {formatCurrency(total, "ILS", locale)}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="spread-months">{t("monthsLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("presetsLabel")} className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={months === p}
                onClick={() => setDraft(String(p))}
                className={cn(
                  "h-8 rounded-md border px-3 text-sm tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  months === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:bg-muted"
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <Input
            id="spread-months"
            type="number"
            inputMode="numeric"
            min={2}
            max={MAX_MONTHS}
            step={1}
            value={draft}
            aria-invalid={!valid}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-20 tabular-nums"
          />
        </div>
      </div>

      <div
        className={cn(
          "rounded-lg border px-3 py-2.5 text-sm",
          valid ? "border-border" : "border-destructive/40 text-destructive"
        )}
        aria-live="polite"
      >
        {valid && last ? (
          <>
            <div className="font-medium tabular-nums">
              {t("perMonth", { amount: formatCurrency(total / months, "ILS", locale) })}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("range", { from: monthName(first), to: monthName(last), months })}
            </div>
          </>
        ) : (
          t("invalid", { max: MAX_MONTHS })
        )}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {saved ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save(null)}>
            {t("stop")}
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={saving || !valid}>
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
