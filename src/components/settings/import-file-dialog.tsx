"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { importTransactionsFile } from "@/lib/api";
import {
  FileReadError,
  applyMapping,
  dataRows,
  guessMapping,
  hasHebrew,
  headerLabels,
  readTable,
  type ColumnMapping,
  type Table,
} from "@/lib/import-file";
import { cn } from "@/lib/utils";
import type { ImportResult } from "@/lib/types";

const NONE = "none";
const PREVIEW_ROWS = 8;

interface ImportFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentialId: number;
  /** The connection the rows will belong to, e.g. "One Zero". */
  connectionLabel: string;
}

export function ImportFileDialog({
  open,
  onOpenChange,
  credentialId,
  connectionLabel,
}: ImportFileDialogProps) {
  const t = useTranslations("importFile");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6 pb-4 pe-12">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {t("title", { name: connectionLabel })}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {/* Remounts on every open so a new import starts from the file picker. */}
        {open ? (
          <ImportFlow credentialId={credentialId} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ImportFlow({ credentialId, onClose }: { credentialId: number; onClose: () => void }) {
  const t = useTranslations("importFile");
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const load = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const next = await readTable(file);
      if (next.length < 2) throw new FileReadError(t("errorNoRows"));
      setTable(next);
      setMapping(guessMapping(next));
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof FileReadError ? err.message : t("errorUnreadable"));
    } finally {
      setReading(false);
    }
  };

  const preview = useMemo(
    () => (table && mapping ? applyMapping(table, mapping) : null),
    [table, mapping]
  );

  const runImport = async () => {
    if (!preview || preview.rows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importTransactionsFile(credentialId, preview.rows, preview.balance);
      setResult({ ...res, skipped: res.skipped + preview.skipped });
      // Totals, lists, insights and bank health all read the new rows.
      void queryClient.invalidateQueries();
    } catch (err) {
      let message = t("errorImport");
      if (err instanceof Error) {
        try {
          message = (JSON.parse(err.message) as { message?: string }).message ?? message;
        } catch {
          /* not JSON */
        }
      }
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  if (result) {
    return <DoneStep result={result} onClose={onClose} />;
  }

  if (!table || !mapping || !preview) {
    return (
      <div className="px-6 pb-6">
        <DropZone reading={reading} onFile={load} />
        {error ? <ErrorNote message={error} /> : null}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6 px-6 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{fileName}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setTable(null);
              setMapping(null);
              setError(null);
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("chooseAnother")}
          </button>
        </div>

        <MappingFields table={table} mapping={mapping} onChange={setMapping} />
        <PreviewTable preview={preview} />
        {error ? <ErrorNote message={error} /> : null}
      </div>

      <DialogFooter className="mx-0 mb-0 rounded-none px-6">
        <Button variant="outline" onClick={onClose} disabled={importing}>
          {t("cancel")}
        </Button>
        <Button onClick={runImport} disabled={importing || preview.rows.length === 0} className="gap-1.5">
          {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {importing ? t("importing") : t("importCount", { count: preview.rows.length })}
        </Button>
      </DialogFooter>
    </>
  );
}

function DropZone({ reading, onFile }: { reading: boolean; onFile: (file: File) => void }) {
  const t = useTranslations("importFile");
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        over ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-card ring-1 ring-border">
        {reading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="size-5 text-muted-foreground" />
        )}
      </span>
      <div>
        <p className="text-sm font-medium">{t("dropTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("dropFormats")}</p>
      </div>
      <Button variant="outline" size="sm" disabled={reading} onClick={() => inputRef.current?.click()}>
        {t("chooseFile")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.txt,.html,.htm,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <p className="max-w-sm text-[11px] text-muted-foreground">{t("privacy")}</p>
    </div>
  );
}

function MappingFields({
  table,
  mapping,
  onChange,
}: {
  table: Table;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const t = useTranslations("importFile");
  const headers = headerLabels(table, mapping.headerRow);
  const set = (patch: Partial<ColumnMapping>) => onChange({ ...mapping, ...patch });

  // A few lines of each candidate header row, so a wrong guess is easy to fix.
  const headerChoices = table.slice(0, 30).map((row, i) => {
    const sample = row
      .map((c) => (c == null ? "" : String(c).trim()))
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");
    return { value: String(i), label: t("headerRowOption", { row: i + 1, sample: sample || "…" }) };
  });

  // Only Hebrew can be stored backwards, so the switch would be noise otherwise.
  const showReversedToggle =
    mapping.description != null &&
    hasHebrew(dataRows(table, mapping.headerRow).map((r) => r[mapping.description!] ?? null));

  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      <Field label={t("headerRow")} className="sm:col-span-2">
        <ChoiceSelect
          value={String(mapping.headerRow)}
          options={headerChoices}
          onChange={(v) => {
            // A new header row means new column names, so guess again from there.
            onChange(guessMapping(table, Number(v)));
          }}
        />
      </Field>

      <Field label={t("dateColumn")}>
        <ColumnSelect headers={headers} value={mapping.date} onChange={(v) => set({ date: v })} />
      </Field>
      <Field label={t("descriptionColumn")}>
        <ColumnSelect
          headers={headers}
          value={mapping.description}
          onChange={(v) => set({ description: v })}
        />
      </Field>

      <Field label={t("amountsLayout")} className="sm:col-span-2">
        <Segmented
          value={mapping.amountMode}
          options={[
            { value: "single", label: t("amountsSingle") },
            { value: "split", label: t("amountsSplit") },
          ]}
          onChange={(v) => set({ amountMode: v === "split" ? "split" : "single" })}
        />
      </Field>

      {mapping.amountMode === "single" ? (
        <>
          <Field label={t("amountColumn")}>
            <ColumnSelect headers={headers} value={mapping.amount} onChange={(v) => set({ amount: v })} />
          </Field>
          <Field label={t("moneyOutLooksLike")}>
            <ChoiceSelect
              value={mapping.moneyOut}
              options={[
                { value: "negative", label: t("moneyOutNegative") },
                { value: "positive", label: t("moneyOutPositive") },
                { value: "column", label: t("moneyOutColumn") },
              ]}
              onChange={(v) =>
                set({ moneyOut: v === "column" ? "column" : v === "positive" ? "positive" : "negative" })
              }
            />
          </Field>
          {mapping.moneyOut === "column" ? (
            <Field label={t("signColumn")} className="sm:col-span-2">
              <ColumnSelect
                headers={headers}
                value={mapping.signColumn}
                onChange={(v) => set({ signColumn: v })}
              />
              <p className="text-[11px] text-muted-foreground">{t("signColumnHint")}</p>
            </Field>
          ) : null}
        </>
      ) : (
        <>
          <Field label={t("debitColumn")}>
            <ColumnSelect headers={headers} value={mapping.debit} onChange={(v) => set({ debit: v })} />
          </Field>
          <Field label={t("creditColumn")}>
            <ColumnSelect headers={headers} value={mapping.credit} onChange={(v) => set({ credit: v })} />
          </Field>
        </>
      )}

      <Field label={t("dateFormat")}>
        <ChoiceSelect
          value={mapping.dateOrder}
          options={[
            { value: "dmy", label: t("dateDayFirst") },
            { value: "mdy", label: t("dateMonthFirst") },
          ]}
          onChange={(v) => set({ dateOrder: v === "mdy" ? "mdy" : "dmy" })}
        />
      </Field>
      <Field label={t("memoColumn")}>
        <ColumnSelect
          headers={headers}
          value={mapping.memo}
          optional
          onChange={(v) => set({ memo: v })}
        />
      </Field>
      <Field label={t("balanceColumn")}>
        <ColumnSelect
          headers={headers}
          value={mapping.balance}
          optional
          onChange={(v) => set({ balance: v })}
        />
      </Field>

      {showReversedToggle ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-3 sm:col-span-2">
          <Switch
            className="mt-0.5"
            checked={mapping.reversedHebrew}
            onCheckedChange={(checked) => set({ reversedHebrew: checked })}
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{t("reversedHebrew")}</span>
            <span className="block text-xs text-muted-foreground">{t("reversedHebrewHint")}</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ColumnSelect({
  headers,
  value,
  optional,
  onChange,
}: {
  headers: string[];
  value: number | null;
  optional?: boolean;
  onChange: (v: number | null) => void;
}) {
  const t = useTranslations("importFile");
  const options = [
    ...(optional || value == null ? [{ value: NONE, label: optional ? t("none") : t("pickColumn") }] : []),
    ...headers.map((h, i) => ({ value: String(i), label: h })),
  ];
  return (
    <ChoiceSelect
      value={value == null ? NONE : String(value)}
      options={options}
      onChange={(v) => onChange(v === NONE ? null : Number(v))}
    />
  );
}

function ChoiceSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v != null) onChange(v);
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>
          {(v: string) => options.find((o) => o.value === v)?.label ?? ""}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PreviewTable({ preview }: { preview: ReturnType<typeof applyMapping> }) {
  const t = useTranslations("importFile");
  const locale = useLocale();
  const bcp = locale === "he" ? "he-IL" : "en-IL";
  const money = (n: number) =>
    `${n < 0 ? "−" : "+"}₪${Math.abs(n).toLocaleString(bcp, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(bcp, { day: "numeric", month: "short", year: "numeric" });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t("previewTitle")}</h3>
        <p className="text-xs text-muted-foreground tabular-nums">
          {t("previewSummary", { ready: preview.rows.length, skipped: preview.skipped })}
        </p>
      </div>
      {preview.otherCurrency > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("previewOtherCurrency", { count: preview.otherCurrency })}
        </p>
      ) : null}
      {preview.balance ? (
        <p className="text-xs text-muted-foreground">
          {t.rich("previewBalance", {
            amount: () => (
              <bdi dir="ltr" className="font-medium text-foreground tabular-nums">
                {`${preview.balance!.amount < 0 ? "−" : ""}₪${Math.abs(preview.balance!.amount).toLocaleString(bcp, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </bdi>
            ),
            date: day(preview.balance.date),
          })}
        </p>
      ) : null}
      {preview.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("previewEmpty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("colDate")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("colDescription")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("colAmount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {preview.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">{day(r.date)}</td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <bdi dir="auto" className="block truncate text-start">
                      {r.description}
                    </bdi>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-end font-medium tabular-nums",
                      r.amount > 0 && "text-[var(--status-on-track)]"
                    )}
                  >
                    <bdi dir="ltr">{money(r.amount)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > PREVIEW_ROWS ? (
            <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
              {t("previewMore", { count: preview.rows.length - PREVIEW_ROWS })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DoneStep({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const t = useTranslations("importFile");
  return (
    <>
      <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--status-on-track)_16%,transparent)]">
          <CircleCheck className="size-6 text-[var(--status-on-track)]" aria-hidden="true" />
        </span>
        <p className="text-lg font-semibold tracking-tight">{t("doneAdded", { count: result.added })}</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {result.updated > 0 ? <li>{t("doneExisting", { count: result.updated })}</li> : null}
          {result.skipped > 0 ? <li>{t("doneSkipped", { count: result.skipped })}</li> : null}
          {result.balanceSaved ? <li>{t("doneBalance")}</li> : null}
          {result.added > 0 ? <li>{t("doneCategorizing")}</li> : null}
        </ul>
      </div>
      <DialogFooter className="mx-0 mb-0 rounded-none px-6">
        <Button onClick={onClose}>{t("done")}</Button>
      </DialogFooter>
    </>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  );
}
