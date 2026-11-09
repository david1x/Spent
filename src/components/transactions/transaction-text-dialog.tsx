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

/** Matches the server's limits (src/server/db/queries/transactions.ts). */
const NAME_MAX = 120;
const NOTE_MAX = 1000;

export interface TransactionTextValues {
  displayName: string | null;
  note: string | null;
}

/**
 * Rename a transaction and add a note about it. The bank's description is
 * kept and shown here, so the user can always tell what the bank called it.
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
          <DialogTitle>{t("renameTitle")}</DialogTitle>
          <DialogDescription>{t("renameDescription")}</DialogDescription>
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

  const clean = (v: string) => (v.trim() === "" ? null : v.trim());
  const unchanged = clean(name) === (txn.displayName ?? null) && clean(note) === (txn.note ?? null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unchanged) return onClose();
    setSaving(true);
    const ok = await onSave(txn, { displayName: clean(name), note: clean(note) });
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("renameCancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? t("renameSaving") : t("renameSave")}
        </Button>
      </DialogFooter>
    </form>
  );
}
