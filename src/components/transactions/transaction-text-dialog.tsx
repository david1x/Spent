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
import { Input, InputGroup } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/formatters";
import { normalizeCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { TransactionWithCategory } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

/** Matches the server's limits (src/server/db/queries/transactions.ts). */
const NAME_MAX = 120;
const NOTE_MAX = 1000;

export interface TransactionTextValues {
  displayName: string | null;
  note: string | null;
  /** Shekels for a foreign purchase; null goes back to automatic, absent leaves it. */
  chargedAmount?: number | null;
}

/** A purchase made in another currency, whose shekel amount the user may set. */
export function isForeignPurchase(txn: TransactionWithCategory): boolean {
  return normalizeCurrency(txn.originalCurrency) !== "ILS" && txn.originalAmount !== 0;
}

const twoDecimals = (n: number) => String(Math.round(Math.abs(n) * 100) / 100);

/**
 * Rename a transaction and add a note about it. The bank's description is
 * kept and shown here, so the user can always tell what the bank called it.
 * A purchase in another currency also gets its shekel amount, to match the
 * card bill when the conversion was off.
 */
export function TransactionTextDialog({
  txn,
  onClose,
  onSave,
}: {
  txn: TransactionWithCategory | null;
  onClose: () => void;
  onSave: (txn: TransactionWithCategory, values: TransactionTextValues) => Promise<boolean>;
}) {
  const t = useTranslations("transactions");
  return (
    <Dialog open={txn !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{txn && isForeignPurchase(txn) ? t("editTitleForeign") : t("renameTitle")}</DialogTitle>
          <DialogDescription>
            {txn && isForeignPurchase(txn) ? t("editDescriptionForeign") : t("renameDescription")}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so each open starts from that row's saved values. */}
        {txn ? <TextForm key={txn.id} txn={txn} onClose={onClose} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TextForm({
  txn,
  onClose,
  onSave,
}: {
  txn: TransactionWithCategory;
  onClose: () => void;
  onSave: (txn: TransactionWithCategory, values: TransactionTextValues) => Promise<boolean>;
}) {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const [name, setName] = useState(txn.displayName ?? "");
  const [note, setNote] = useState(txn.note ?? "");
  const [saving, setSaving] = useState(false);
  const foreign = isForeignPurchase(txn);
  const savedAmount = twoDecimals(txn.chargedAmount);
  const [amount, setAmount] = useState(savedAmount);
  // "Use the automatic amount" on a row whose amount the user had set.
  const [backToAuto, setBackToAuto] = useState(false);

  const clean = (v: string) => (v.trim() === "" ? null : v.trim());
  const parsedAmount = amount.trim() === "" ? NaN : Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const amountChanged = foreign && !backToAuto && amountValid && Math.abs(parsedAmount - Number(savedAmount)) >= 0.005;
  const amountInvalid = foreign && !backToAuto && !amountValid;
  const unchanged =
    clean(name) === (txn.displayName ?? null) &&
    clean(note) === (txn.note ?? null) &&
    !amountChanged &&
    !backToAuto;
  const rate = amountValid ? parsedAmount / Math.abs(txn.originalAmount) : null;
  const currency = normalizeCurrency(txn.originalCurrency);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amountInvalid) return;
    if (unchanged) return onClose();
    setSaving(true);
    const ok = await onSave(txn, {
      displayName: clean(name),
      note: clean(note),
      ...(backToAuto ? { chargedAmount: null } : amountChanged ? { chargedAmount: parsedAmount } : {}),
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="text-[11px] text-muted-foreground">{t("renameBankName")}</div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <bdi className="min-w-0 truncate font-mono text-[13px]" title={txn.description}>
            {txn.description}
          </bdi>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {new Date(txn.date).toLocaleDateString(locale === "he" ? "he-IL" : "en-IL", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}{" "}
            · {formatCurrency(txn.chargedAmount)}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="txn-name">{t("renameNameLabel")}</Label>
          {name !== "" ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => setName("")}
            >
              {t("renameReset")}
            </button>
          ) : null}
        </div>
        <Input
          id="txn-name"
          value={name}
          maxLength={NAME_MAX}
          placeholder={t("renameNamePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          dir="auto"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="txn-note">{t("renameNoteLabel")}</Label>
        <textarea
          id="txn-note"
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          dir="auto"
          placeholder={t("renameNotePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter saves; plain Enter makes a new line.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className={cn(
            "flex w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors outline-none",
            "placeholder:text-muted-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        />
      </div>

      {foreign ? (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="txn-amount">{t("amountLabel")}</Label>
            {txn.chargedByUser && !backToAuto ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setBackToAuto(true)}
              >
                {t("amountUseAuto")}
              </button>
            ) : backToAuto ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setBackToAuto(false)}
              >
                {t("amountKeepMine")}
              </button>
            ) : null}
          </div>
          {backToAuto ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              {t("amountAutoPending")}
            </p>
          ) : (
            <InputGroup prefix="₪">
              <Input
                id="txn-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className="tabular-nums"
                value={amount}
                aria-invalid={amountInvalid}
                onChange={(e) => setAmount(e.target.value)}
              />
            </InputGroup>
          )}
          <p className={cn("text-[11px]", amountInvalid ? "text-destructive" : "text-muted-foreground")}>
            {amountInvalid
              ? t("amountInvalid")
              : t("amountHint", {
                  original: formatCurrency(Math.abs(txn.originalAmount), txn.originalCurrency, locale),
                  rate: rate != null && !backToAuto ? rate.toFixed(3) : "-",
                  currency,
                })}
            {!amountInvalid && txn.chargedEstimated && !backToAuto ? ` ${t("amountWasEstimate")}` : null}
            {!amountInvalid && txn.chargedByUser && !backToAuto ? ` ${t("amountIsYours")}` : null}
          </p>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("renameCancel")}
        </Button>
        <Button type="submit" disabled={saving || amountInvalid}>
          {saving ? t("renameSaving") : t("renameSave")}
        </Button>
      </DialogFooter>
    </form>
  );
}
