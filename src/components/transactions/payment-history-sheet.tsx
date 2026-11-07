"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ListFilter } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTransactionHistory } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { translateCategoryName } from "@/lib/i18n-data";
import { formatPeriodLabel, periodContaining, shiftPeriod, type Period } from "@/lib/period";
import { cn } from "@/lib/utils";
import { useBudgetPeriod } from "@/components/layout/use-budget-period";
import { AccountMark } from "./transaction-source-cell";
import { INCOME_INK } from "./summary-strip";
import type { InstallmentPlan, TransactionHistory, TransactionWithCategory } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

type Translator = ReturnType<typeof useTranslations<"transactions">>;

/** Periods in the merchant chart, ending with the current one. */
const CHART_PERIODS = 12;
/** A segmented installment bar stops reading as segments past this many. */
const MAX_SEGMENTS = 36;
const LIST_PAGE = 30;
/** Expected installments listed before the rest fold away. */
const UPCOMING_SHOWN = 3;

interface PaymentHistorySheetProps {
  transactionId: number | null;
  onClose: () => void;
  /** Lists every payment to this merchant on the Transactions page, all time. */
  onShowAll?: (description: string) => void;
}

/** Where a payment came from and where it goes: its installment plan and the merchant's months. */
export function PaymentHistorySheet({ transactionId, onClose, onShowAll }: PaymentHistorySheetProps) {
  const open = transactionId !== null;
  const query = useQuery({
    enabled: open,
    queryKey: ["transaction-history", transactionId],
    queryFn: () => getTransactionHistory(transactionId as number),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full sm:max-w-lg!">
        {query.data && query.data.transaction.id === transactionId ? (
          <HistoryContent
            data={query.data}
            onShowAll={
              onShowAll
                ? () => {
                    onShowAll(query.data.transaction.description);
                    onClose();
                  }
                : undefined
            }
          />
        ) : query.isError ? (
          <ErrorState />
        ) : (
          <HistorySkeleton />
        )}
      </SheetContent>
    </Sheet>
  );
}

function HistoryContent({ data, onShowAll }: { data: TransactionHistory; onShowAll?: () => void }) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const txn = data.transaction;
  const categoryName = txn.categoryName ? translateCategoryName(txn.categoryName, tCat) : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <SheetHeader className="gap-2 border-b border-border p-6 pe-12 pb-5">
        <div className="text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
          {t("historyEyebrow")}
        </div>
        <SheetTitle className="line-clamp-2 text-xl font-semibold tracking-tight">
          <bdi>{txn.description}</bdi>
        </SheetTitle>
        <SheetDescription render={<div />} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          {categoryName ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: txn.categoryColor ?? "var(--muted-foreground)" }}
                aria-hidden
              />
              {categoryName}
            </span>
          ) : null}
          <AccountMark
            provider={txn.provider}
            accountLabel={txn.accountLabel}
            accountNumber={txn.accountNumber}
            size="sm"
          />
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-7 p-6">
        {data.plan ? <InstallmentSection plan={data.plan} current={txn} t={t} locale={locale} /> : null}
        <MerchantSection data={data} t={t} locale={locale} />
      </div>

      {onShowAll ? (
        <div className="sticky bottom-0 border-t border-border bg-popover/95 p-4 backdrop-blur">
          <Button variant="outline" className="w-full" onClick={onShowAll}>
            <ListFilter className="h-4 w-4" />
            {t("historyShowAll")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
        {children}
      </h3>
      {aside ? <div className="text-xs text-muted-foreground tabular-nums">{aside}</div> : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-base font-semibold tracking-tight tabular-nums sm:text-lg">
        <bdi>{value}</bdi>
      </div>
      {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function bcp47(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-IL";
}

function shortDate(iso: string, locale: Locale, withYear = false): string {
  return new Date(iso).toLocaleDateString(bcp47(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function InstallmentSection({
  plan,
  current,
  t,
  locale,
}: {
  plan: InstallmentPlan;
  current: TransactionWithCategory;
  t: Translator;
  locale: Locale;
}) {
  const money = (n: number) => formatCurrency(n, plan.currency || "ILS", locale);
  const total = plan.total;
  const left = total !== null ? Math.max(0, total - plan.paidCount) : 0;
  const paidAmount =
    total !== null
      ? Math.max(0, plan.purchaseAmount - plan.remaining)
      : plan.payments.reduce((sum, p) => sum + Math.abs(p.chargedAmount), 0);
  const pct = plan.purchaseAmount > 0 ? Math.min(100, (paidAmount / plan.purchaseAmount) * 100) : 0;
  const firstKnown = plan.payments.find((p) => (p.installmentNumber ?? 0) > 0)?.installmentNumber ?? 1;
  const lastUpcoming = plan.upcoming[plan.upcoming.length - 1];
  const [allUpcoming, setAllUpcoming] = useState(false);
  const upcoming = allUpcoming ? plan.upcoming : plan.upcoming.slice(0, UPCOMING_SHOWN);
  const hiddenUpcoming = plan.upcoming.length - upcoming.length;
  // Fixed when the sheet opens, so re-renders agree on what is still ahead.
  const [now] = useState(() => Date.now());

  return (
    <section>
      <SectionHeading
        aside={total !== null ? t("historyPlanProgress", { paid: plan.paidCount, total }) : undefined}
      >
        {t("historyPlanTitle")}
      </SectionHeading>

      <div className="rounded-xl border border-border p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("historyPurchase")} value={money(plan.purchaseAmount)} />
          <Stat label={t("historyPaid")} value={money(paidAmount)} />
          <Stat
            label={t("historyLeft")}
            value={money(plan.remaining)}
            sub={left > 0 ? t("historyPaymentsLeft", { count: left }) : t("historyPaidOff")}
          />
        </div>

        {total !== null && total <= MAX_SEGMENTS ? (
          <div className="mt-4 flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-2 flex-1 rounded-full",
                  i < plan.paidCount ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
        {lastUpcoming ? (
          <p className="mt-2.5 text-xs text-muted-foreground">
            {t("historyLastPayment", {
              date: new Date(lastUpcoming.date).toLocaleDateString(bcp47(locale), {
                month: "long",
                year: "numeric",
              }),
            })}
          </p>
        ) : null}
      </div>

      <ol className="mt-3 divide-y divide-border rounded-xl border border-border">
        {firstKnown > 1 ? (
          <li className="px-4 py-2.5 text-xs text-muted-foreground">
            {t("historyBeforeSync", { count: firstKnown - 1 })}
          </li>
        ) : null}
        {plan.payments.map((p) => (
          <li
            key={p.id}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 text-[13px]",
              p.id === current.id && "bg-primary/[0.07]"
            )}
          >
            <span className="w-20 shrink-0 font-medium whitespace-nowrap sm:w-24">
              {p.installmentNumber
                ? t("historyPaymentN", { n: p.installmentNumber })
                : t("historyPaymentUnknown")}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-muted-foreground tabular-nums">
              <span className="whitespace-nowrap">{shortDate(p.processedDate, locale, true)}</span>
              {p.status === "pending" || new Date(p.processedDate).getTime() > now ? (
                <span className="truncate text-[11px]">
                  {p.status === "pending" ? t("historyPending") : t("historyNextBill")}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">
              <bdi>{money(Math.abs(p.chargedAmount))}</bdi>
            </span>
          </li>
        ))}
        {upcoming.map((u) => (
          <li key={`u${u.number}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-muted-foreground">
            <span className="w-20 shrink-0 whitespace-nowrap sm:w-24">{t("historyPaymentN", { n: u.number })}</span>
            <span className="flex min-w-0 flex-1 flex-col tabular-nums">
              <span className="whitespace-nowrap">
                {new Date(u.date).toLocaleDateString(bcp47(locale), { month: "short", year: "numeric" })}
              </span>
              <span className="truncate text-[11px]">{t("historyExpected")}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              <bdi>≈ {money(u.amount)}</bdi>
            </span>
          </li>
        ))}
        {hiddenUpcoming > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setAllUpcoming(true)}
              className="w-full rounded-b-xl px-4 py-2.5 text-start text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("historyMoreExpected", { count: hiddenUpcoming })}
            </button>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

interface PeriodBucket {
  period: Period;
  key: string;
  total: number;
  rows: TransactionWithCategory[];
}

function MerchantSection({ data, t, locale }: { data: TransactionHistory; t: Translator; locale: Locale }) {
  const txn = data.transaction;
  const { startDay, period: currentPeriod } = useBudgetPeriod(new Date(), locale);
  const [shown, setShown] = useState(LIST_PAGE);
  const isIncome = txn.chargedAmount > 0;
  const money = (n: number) => formatCurrency(n, "ILS", locale);

  // Same direction as the opened row only, so refunds don't cancel out a
  // merchant's purchases.
  const rows = useMemo(
    () => data.merchant.transactions.filter((r) => r.chargedAmount > 0 === isIncome),
    [data.merchant.transactions, isIncome]
  );

  const buckets = useMemo(() => {
    const map = new Map<string, PeriodBucket>();
    for (const r of rows) {
      const period = periodContaining(new Date(r.date), startDay);
      const key = period.start.toDateString();
      const b = map.get(key) ?? { period, key, total: 0, rows: [] };
      b.total += Math.abs(r.chargedAmount);
      b.rows.push(r);
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => b.period.start.getTime() - a.period.start.getTime());
  }, [rows, startDay]);

  const total = buckets.reduce((sum, b) => sum + b.total, 0);
  const first = rows[rows.length - 1];
  const average = buckets.length > 0 ? total / buckets.length : 0;
  const selectedKey = periodContaining(new Date(txn.date), startDay).start.toDateString();

  const byKey = new Map(buckets.map((b) => [b.key, b.total]));
  const chart = Array.from({ length: CHART_PERIODS }, (_, i) => {
    const period = shiftPeriod(currentPeriod, i - (CHART_PERIODS - 1), startDay);
    const key = period.start.toDateString();
    return { period, key, total: byKey.get(key) ?? 0 };
  });
  const chartMax = Math.max(...chart.map((c) => c.total), 1);
  const truncated = data.merchant.count > data.merchant.transactions.length;

  // Rows for the list, keeping whole periods together up to the page size.
  let budget = shown;
  const listed: PeriodBucket[] = [];
  for (const b of buckets) {
    if (budget <= 0) break;
    listed.push(b.rows.length <= budget ? b : { ...b, rows: b.rows.slice(0, budget) });
    budget -= b.rows.length;
  }

  return (
    <section>
      <SectionHeading aside={t("historyPaymentsCount", { count: rows.length })}>
        {isIncome ? t("historyFromMerchant") : t("historyAtMerchant")}
      </SectionHeading>

      <div className="grid grid-cols-3 gap-3 rounded-xl border border-border p-4">
        <Stat label={t("historyTotal")} value={money(total)} />
        <Stat label={t("historyPerMonth")} value={money(average)} sub={t("historyMonthsActive", { count: buckets.length })} />
        <Stat
          label={t("historySince")}
          value={first ? shortDate(first.date, locale, true) : "–"}
        />
      </div>

      {rows.length > 1 ? (
        <div className="mt-3 rounded-xl border border-border px-4 pt-4 pb-3">
          <div dir="ltr" className="flex h-24 items-end gap-1" role="img" aria-label={t("historyChartLabel")}>
            {chart.map((c) => {
              const h = c.total > 0 ? Math.max(4, (c.total / chartMax) * 100) : 0;
              return (
                <div key={c.key} className="flex h-full flex-1 flex-col justify-end" title={`${formatPeriodLabel(c.period, locale)}: ${money(c.total)}`}>
                  {c.total > 0 ? (
                    <div
                      className={cn(
                        "w-full rounded-t-[3px]",
                        c.key === selectedKey ? "bg-primary" : "bg-primary/35"
                      )}
                      style={{ height: `${h}%` }}
                    />
                  ) : (
                    <div className="h-px w-full bg-border" />
                  )}
                </div>
              );
            })}
          </div>
          <div dir="ltr" className="mt-1.5 flex gap-1" aria-hidden>
            {chart.map((c, i) => (
              <div
                key={c.key}
                className={cn(
                  "flex-1 text-center text-[10px] text-muted-foreground",
                  c.key === selectedKey && "font-semibold text-foreground",
                  // Every other label on narrow screens, counted from the newest so it stays.
                  (CHART_PERIODS - 1 - i) % 2 === 1 && "max-sm:invisible"
                )}
              >
                {c.period.start.toLocaleDateString(bcp47(locale), { month: "short" })}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-4">
        {listed.map((b) => (
          <div key={b.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 px-1 text-xs">
              <span className="font-semibold">{formatPeriodLabel(b.period, locale)}</span>
              <span className="text-muted-foreground tabular-nums">
                <bdi>{money(b.total)}</bdi>
              </span>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {b.rows.map((r) => (
                <HistoryRow key={r.id} row={r} selected={r.id === txn.id} t={t} locale={locale} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {shown < rows.length ? (
        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setShown((n) => n + LIST_PAGE)}>
          {t("historyShowMore")}
        </Button>
      ) : truncated ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t("historyTruncated", { count: data.merchant.transactions.length })}
        </p>
      ) : null}
    </section>
  );
}

function HistoryRow({
  row,
  selected,
  t,
  locale,
}: {
  row: TransactionWithCategory;
  selected: boolean;
  t: Translator;
  locale: Locale;
}) {
  const income = row.chargedAmount > 0;
  const detail =
    row.type === "installments" && row.installmentNumber && row.installmentTotal
      ? t("rowInstallment", { n: row.installmentNumber, total: row.installmentTotal })
      : row.memo?.trim() || null;
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5 text-[13px]", selected && "bg-primary/[0.07]")}>
      <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{shortDate(row.date, locale)}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {detail ? <bdi>{detail}</bdi> : null}
        {row.status === "pending" ? (detail ? ` · ${t("historyPending")}` : t("historyPending")) : null}
      </span>
      <AccountMark
        provider={row.provider}
        accountLabel={row.accountLabel}
        accountNumber={row.accountNumber}
        size="sm"
        hideLabel
        className="shrink-0 text-xs text-muted-foreground"
      />
      <span
        className={cn("shrink-0 font-medium tabular-nums", row.isExcluded && "text-muted-foreground")}
        style={income && !row.isExcluded ? { color: INCOME_INK } : undefined}
        title={row.chargedEstimated ? t("amountEstimatedHint") : undefined}
      >
        <bdi>
          {row.chargedEstimated ? "≈ " : ""}
          {income ? "+" : ""}
          {formatCurrency(row.chargedAmount, "ILS", locale)}
        </bdi>
      </span>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

function ErrorState() {
  const t = useTranslations("transactions");
  return (
    <div className="p-6 pe-12">
      <SheetTitle className="text-base font-semibold">{t("historyEyebrow")}</SheetTitle>
      <p className="mt-2 text-sm text-muted-foreground">{t("historyError")}</p>
    </div>
  );
}
