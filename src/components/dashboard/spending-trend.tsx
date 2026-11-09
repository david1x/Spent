"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartTooltip, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { formatK, formatNumberWhole, formatWhole } from "@/components/home/home-format";
import { getSpendingTrend } from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import {
  formatRangeLabel,
  parseISODay,
  periodContaining,
  shiftPeriod,
  type Period,
} from "@/lib/period";
import { cn } from "@/lib/utils";
import { BudgetDetailSheet } from "./budget-detail-sheet";
import type { SpendingTrend, TrendCategory, TrendPeriod } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { BudgetEditPopover } from "@/components/budget/budget-edit-popover";

// ---------------------------------------------------------------------------
// The range

export type TrendRange =
  | { kind: "last"; count: number }
  | { kind: "year"; year: number }
  /** First and last month as "YYYY-MM". */
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_TREND_RANGE: TrendRange = { kind: "last", count: 12 };

/** How far back the custom range's month lists reach. */
const PICKER_MONTHS = 36;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fromMonthKey(key: string, startDay: number): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, startDay);
}

/** The first and last period a range covers. The server stops at the running period. */
export function trendSpan(range: TrendRange, startDay: number, today = new Date()): Period {
  const current = periodContaining(today, startDay);
  if (range.kind === "last") {
    return { start: shiftPeriod(current, -(range.count - 1), startDay).start, end: current.end };
  }
  if (range.kind === "year") {
    const first = periodContaining(new Date(range.year, 0, startDay), startDay);
    const last = periodContaining(new Date(range.year, 11, startDay), startDay);
    return { start: first.start, end: (last.start > current.start ? current : last).end };
  }
  let a = fromMonthKey(range.from, startDay);
  let b = fromMonthKey(range.to, startDay);
  if (a > b) [a, b] = [b, a];
  return { start: periodContaining(a, startDay).start, end: periodContaining(b, startDay).end };
}

function sameRange(a: TrendRange, b: TrendRange): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function TrendRangePicker({
  range,
  onChange,
  label,
  startDay,
}: {
  range: TrendRange;
  onChange: (range: TrendRange) => void;
  label: string;
  startDay: number;
}) {
  const t = useTranslations("dashboard.trend");
  const locale = useLocale() as Locale;
  const bcp = locale === "he" ? "he-IL" : "en-IL";
  const [open, setOpen] = useState(false);
  const thisYear = new Date().getFullYear();

  // Every month from three years back to now, newest first.
  const months = useMemo(() => {
    const current = periodContaining(new Date(), startDay);
    return Array.from({ length: PICKER_MONTHS }, (_, i) => {
      const p = shiftPeriod(current, -i, startDay);
      return {
        value: monthKey(p.start),
        label: p.start.toLocaleDateString(bcp, { month: "short", year: "numeric" }),
      };
    });
  }, [startDay, bcp]);

  const span = trendSpan(range, startDay);
  const [customFrom, setCustomFrom] = useState(
    range.kind === "custom" ? range.from : monthKey(span.start)
  );
  const [customTo, setCustomTo] = useState(range.kind === "custom" ? range.to : monthKey(span.end));

  const presets: { range: TrendRange; label: string }[] = [
    { range: { kind: "last", count: 6 }, label: t("last", { count: 6 }) },
    { range: { kind: "last", count: 12 }, label: t("last", { count: 12 }) },
    { range: { kind: "last", count: 24 }, label: t("last", { count: 24 }) },
    { range: { kind: "year", year: thisYear }, label: t("thisYear", { year: thisYear }) },
    { range: { kind: "year", year: thisYear - 1 }, label: String(thisYear - 1) },
  ];

  const pick = (next: TrendRange) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 tabular-nums" aria-label={label}>
            <CalendarRange className="size-3.5 text-muted-foreground" aria-hidden />
            {/* The page header already names the range on phones. */}
            <span className="hidden whitespace-nowrap sm:inline">{label}</span>
          </Button>
        }
      />
      <PopoverContent className="w-72 p-1.5">
        <div className="space-y-0.5">
          {presets.map((p) => {
            const active = sameRange(p.range, range);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p.range)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-start text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
                  active && "font-medium"
                )}
              >
                {p.label}
                {active ? <Check className="size-3.5" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 space-y-2.5 border-t border-border px-1.5 pt-3 pb-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("customTitle")}</p>
          <div className="grid grid-cols-2 gap-2">
            <MonthSelect label={t("customFrom")} value={customFrom} options={months} onChange={setCustomFrom} />
            <MonthSelect label={t("customTo")} value={customTo} options={months} onChange={setCustomTo} />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() => pick({ kind: "custom", from: customFrom, to: customTo })}
          >
            {t("customApply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(v) => v != null && onChange(v)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue>{(v: string) => options.find((o) => o.value === v)?.label ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// The view

/** Categories that get their own color in the bars; the rest share "Other". */
const STACKED_CATEGORIES = 6;
/** Rows shown in the category grid before "Show all". */
const GRID_ROWS = 10;

interface Named extends TrendCategory {
  label: string;
}

function periodLabel(p: TrendPeriod, bcp: string, style: "short" | "long"): string {
  const d = parseISODay(p.from) ?? new Date();
  return d.toLocaleDateString(bcp, style === "long" ? { month: "long", year: "numeric" } : { month: "short" });
}

export function SpendingTrendView({
  from,
  to,
  onOpenMonth,
}: {
  from: string;
  to: string;
  /** Switches the page to one period's month view. */
  onOpenMonth: (day: Date) => void;
}) {
  const t = useTranslations("dashboard.trend");
  const tCat = useTranslations("categoriesSeeded");
  const query = useQuery({
    queryKey: ["summary-trend", from, to],
    queryFn: () => getSpendingTrend({ from, to }),
  });
  const [detail, setDetail] = useState<{ categoryId: number; from: string; to: string } | null>(null);

  const categories: Named[] = useMemo(
    () => (query.data?.categories ?? []).map((c) => ({ ...c, label: translateCategoryName(c.name, tCat) })),
    [query.data, tCat]
  );

  if (query.isLoading || !query.data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }

  const data = query.data;
  if (data.periods.every((p) => p.spent === 0)) {
    return (
      <div className="rounded-3xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TrendHero data={data} />
      <MonthlyBars data={data} categories={categories} onOpenMonth={onOpenMonth} />
      <CategoryGrid
        data={data}
        categories={categories}
        onOpen={(categoryId, range) => setDetail({ categoryId, ...range })}
      />
      <BudgetDetailSheet
        categoryId={detail?.categoryId ?? null}
        from={detail?.from ?? from}
        to={detail?.to ?? to}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headline

function TrendHero({ data }: { data: SpendingTrend }) {
  const t = useTranslations("dashboard.trend");
  const locale = useLocale() as Locale;
  const bcp = locale === "he" ? "he-IL" : "en-IL";

  const { periods, monthlyTarget } = data;
  const total = periods.reduce((s, p) => s + p.spent, 0);
  const income = periods.reduce((s, p) => s + p.income, 0);
  // A running period would drag the typical month down, so it's left out of the averages.
  const full = periods.filter((p) => !p.inProgress);
  const basis = full.length > 0 ? full : periods;
  // The median: one unusual month (a big cash withdrawal) shouldn't set the typical one.
  const sorted = basis.map((p) => p.spent).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const average = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const highest = basis.reduce((a, b) => (b.spent > a.spent ? b : a));
  const lowest = basis.reduce((a, b) => (b.spent < a.spent ? b : a));
  const within = full.filter((p) => p.spent <= monthlyTarget).length;
  const first = parseISODay(periods[0].from)!;
  const last = parseISODay(periods[periods.length - 1].to)!;

  const stats: { label: string; value: string; note?: string }[] = [
    { label: t("statAverage"), value: formatWhole(average, locale) },
    { label: t("statHighest"), value: formatWhole(highest.spent, locale), note: periodLabel(highest, bcp, "long") },
    { label: t("statLowest"), value: formatWhole(lowest.spent, locale), note: periodLabel(lowest, bcp, "long") },
    { label: t("statIncome"), value: formatWhole(income, locale) },
  ];

  return (
    <section className="rounded-3xl border border-border bg-card p-6 md:p-8 lg:p-10">
      <p className="text-sm text-muted-foreground">
        {formatRangeLabel(first, last, locale)} · {t("periodCount", { count: periods.length })}
      </p>
      <h2 className="mt-4 max-w-4xl text-2xl leading-snug font-semibold tracking-tight text-balance md:text-3xl lg:text-[2.5rem] lg:leading-[1.15]">
        {t.rich("headline", {
          total: formatWhole(total, locale),
          average: formatWhole(average, locale),
          count: periods.length,
          em: (chunks) => <span className="text-primary">{chunks}</span>,
        })}
      </h2>
      <p className="mt-3 text-sm text-muted-foreground md:text-base">
        {monthlyTarget > 0
          ? full.length > 0
            ? t("targetRecord", { within, count: full.length, target: formatWhole(monthlyTarget, locale) })
            : t("targetOnlyRunning")
          : t("targetNone")}
      </p>
      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-6 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{s.value}</dd>
            {s.note ? <dd className="text-xs text-muted-foreground">{s.note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bars

const OTHER_COLOR = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";

/** A rounded axis maximum and its gridline steps. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0] };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

function MonthlyBars({
  data,
  categories,
  onOpenMonth,
}: {
  data: SpendingTrend;
  categories: Named[];
  onOpenMonth: (day: Date) => void;
}) {
  const t = useTranslations("dashboard.trend");
  const locale = useLocale() as Locale;
  const bcp = locale === "he" ? "he-IL" : "en-IL";
  const { containerRef, tip, show, hide } = useChartTip();
  const [hovered, setHovered] = useState<number | null>(null);

  const stacked = categories.slice(0, STACKED_CATEGORIES);
  const { periods, monthlyTarget } = data;
  const { top, ticks } = niceScale(Math.max(monthlyTarget, ...periods.map((p) => p.spent)));
  const pct = (v: number) => `${(v / top) * 100}%`;

  const segmentsOf = (p: TrendPeriod) => {
    const own = stacked.map((c) => ({ key: String(c.categoryId), color: c.color, label: c.label, value: p.byCategory[c.categoryId] ?? 0 }));
    const other = p.spent - own.reduce((s, x) => s + x.value, 0);
    return [...own, { key: "other", color: OTHER_COLOR, label: t("other"), value: Math.max(0, other) }].filter(
      (s) => s.value > 0
    );
  };

  const tipFor = (p: TrendPeriod) => {
    const top4 = segmentsOf(p)
      .filter((s) => s.key !== "other")
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
    const rows: Array<[ReactNode, ReactNode]> = [
      [t("tipSpent"), formatWhole(p.spent, locale)],
      ...top4.map((s): [ReactNode, ReactNode] => [s.label, formatWhole(s.value, locale)]),
      [t("tipIncome"), formatWhole(p.income, locale)],
    ];
    if (monthlyTarget > 0) {
      const diff = p.spent - monthlyTarget;
      rows.push([
        diff > 0 ? t("tipOver") : t("tipUnder"),
        formatWhole(Math.abs(diff), locale),
      ]);
    }
    return (
      <TipBody
        title={`${periodLabel(p, bcp, "long")}${p.inProgress ? ` · ${t("soFar")}` : ""}`}
        rows={rows}
      />
    );
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 md:p-8">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">{t("barsTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("barsSubtitle")}</p>
      </div>

      <div ref={containerRef} className="relative">
        <div className="relative h-64 ps-10">
          {/* Gridlines and axis labels, recessive. */}
          {ticks.map((v) => (
            <div
              key={v}
              className="pointer-events-none absolute inset-x-0 flex items-center"
              style={{ bottom: pct(v), transform: "translateY(50%)" }}
              aria-hidden
            >
              <span className="w-9 pe-2 text-end text-[10px] text-muted-foreground tabular-nums">
                {formatK(v)}
              </span>
              <span className={cn("h-px flex-1", v === 0 ? "bg-border" : "bg-border/50")} />
            </div>
          ))}

          {monthlyTarget > 0 ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center ps-10"
              style={{ bottom: pct(monthlyTarget), transform: "translateY(50%)" }}
              aria-hidden
            >
              <span className="h-0 flex-1 border-t-2 border-dashed border-foreground/45" />
              <span className="ms-2 rounded bg-card px-1 text-[10px] font-medium text-foreground/80 tabular-nums">
                {t("targetLine", { amount: formatK(monthlyTarget) })}
              </span>
            </div>
          ) : null}

          <div className="relative flex h-full items-end gap-1.5 sm:gap-2" onMouseLeave={() => { hide(); setHovered(null); }}>
            {periods.map((p, i) => {
              const segments = segmentsOf(p);
              const dim = hovered != null && hovered !== i;
              return (
                <button
                  key={p.from}
                  type="button"
                  className="group relative flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseEnter={(e) => {
                    setHovered(i);
                    show(e.currentTarget.querySelector("[data-bar]") ?? e.currentTarget, tipFor(p));
                  }}
                  onFocus={(e) => {
                    setHovered(i);
                    show(e.currentTarget.querySelector("[data-bar]") ?? e.currentTarget, tipFor(p));
                  }}
                  onBlur={() => { hide(); setHovered(null); }}
                  onClick={() => onOpenMonth(parseISODay(p.from)!)}
                  aria-label={`${periodLabel(p, bcp, "long")}: ${formatWhole(p.spent, locale)}`}
                >
                  <div
                    data-bar
                    className={cn(
                      "flex w-full max-w-11 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity",
                      dim && "opacity-40",
                      p.inProgress && "opacity-70"
                    )}
                    style={{ height: pct(p.spent) }}
                  >
                    {segments.map((s) => (
                      <div key={s.key} style={{ flexGrow: s.value, flexBasis: 0, background: s.color, minHeight: 2 }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Month labels; the year shows on the first bar and on each January. */}
        <div className="mt-2 flex gap-1.5 ps-10 sm:gap-2" aria-hidden>
          {periods.map((p, i) => {
            const d = parseISODay(p.from)!;
            const showYear = i === 0 || d.getMonth() === 0;
            return (
              <div key={p.from} className="min-w-0 flex-1 text-center text-[10px] leading-tight text-muted-foreground">
                <div className={cn("truncate", hovered === i && "font-medium text-foreground")}>
                  <span className="sm:hidden">{d.toLocaleDateString(bcp, { month: "narrow" })}</span>
                  <span className="hidden sm:inline">{d.toLocaleDateString(bcp, { month: "short" })}</span>
                </div>
                <div className="h-3 truncate tabular-nums">
                  {showYear ? (
                    <>
                      <span className="sm:hidden">{String(d.getFullYear()).slice(2)}</span>
                      <span className="hidden sm:inline">{d.getFullYear()}</span>
                    </>
                  ) : p.inProgress ? (
                    <span className="hidden sm:inline">{t("soFar")}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <ChartTooltip tip={tip} />
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {stacked.map((c) => (
          <li key={c.categoryId} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden />
            {c.label}
          </li>
        ))}
        {categories.length > STACKED_CATEGORIES || periods.some((p) => p.uncategorized > 0) ? (
          <li className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ background: OTHER_COLOR }} aria-hidden />
            {t("other")}
          </li>
        ) : null}
        {monthlyTarget > 0 ? (
          <li className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-4 border-t-2 border-dashed border-foreground/45" aria-hidden />
            {t("targetLegend")}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Category by month grid

function CategoryGrid({
  data,
  categories,
  onOpen,
}: {
  data: SpendingTrend;
  categories: Named[];
  onOpen: (categoryId: number, range: { from: string; to: string }) => void;
}) {
  const t = useTranslations("dashboard.trend");
  const locale = useLocale() as Locale;
  const bcp = locale === "he" ? "he-IL" : "en-IL";
  const [showAll, setShowAll] = useState(false);
  const { periods } = data;
  const rows = showAll ? categories : categories.slice(0, GRID_ROWS);
  const fullCount = Math.max(1, periods.filter((p) => !p.inProgress).length);
  const whole = { from: periods[0].from, to: periods[periods.length - 1].to };
  const uncategorized = periods.reduce((s, p) => s + p.uncategorized, 0);
  const showUncategorized = uncategorized >= 1;
  // Categories are top level here (a parent already includes its children), so this doesn't double count.
  const totalBudget = categories.reduce((sum, c) => sum + c.monthlyBudget, 0);
  const num = (v: number) => (v > 0 ? formatNumberWhole(v, locale) : "–");

  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 md:p-8">
      <div className="mb-5">
        <h2 className="font-serif text-2xl">{t("gridTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("gridSubtitle")}</p>
      </div>

      <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        <table className="w-full border-separate border-spacing-[3px] text-xs tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="sticky start-0 z-10 bg-card pe-3 text-start font-medium">{t("gridCategory")}</th>
              {periods.map((p) => (
                <th key={p.from} className="min-w-[3.75rem] px-1 pb-1 text-end font-medium">
                  {periodLabel(p, bcp, "short")}
                  {p.inProgress ? <span className="block text-[10px] font-normal">{t("soFar")}</span> : null}
                </th>
              ))}
              <th className="min-w-[4.5rem] ps-3 text-end font-medium">{t("gridAverage")}</th>
              <th className="min-w-[4.5rem] ps-1 text-end font-medium">{t("gridBudget")}</th>
              <th className="min-w-[4.5rem] ps-1 text-end font-medium">{t("gridTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const values = periods.map((p) => p.byCategory[c.categoryId] ?? 0);
              const rowMax = Math.max(...values);
              const average =
                periods.reduce((s, p) => s + (p.inProgress ? 0 : (p.byCategory[c.categoryId] ?? 0)), 0) / fullCount;
              return (
                <tr key={c.categoryId}>
                  <th scope="row" className="sticky start-0 z-10 bg-card pe-3 text-start font-normal">
                    <button
                      type="button"
                      className="flex max-w-[11rem] items-center gap-2 rounded py-1 text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onOpen(c.categoryId, whole)}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
                      <span className="truncate">{c.label}</span>
                    </button>
                  </th>
                  {periods.map((p, i) => {
                    const v = values[i];
                    const over = c.monthlyBudget > 0 && v > c.monthlyBudget;
                    // Shaded against the row's own busiest month, in the category's color.
                    const strength = rowMax > 0 && v > 0 ? 8 + (v / rowMax) * 42 : 0;
                    return (
                      <td key={p.from} className="p-0">
                        <button
                          type="button"
                          disabled={v === 0}
                          onClick={() => onOpen(c.categoryId, { from: p.from, to: p.to })}
                          title={over ? t("overBudget", { amount: formatWhole(c.monthlyBudget, locale) }) : undefined}
                          className={cn(
                            "relative block w-full rounded-md px-2 py-1.5 text-end outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring enabled:hover:ring-1 enabled:hover:ring-foreground/30",
                            v === 0 && "text-muted-foreground/50"
                          )}
                          style={strength ? { background: `color-mix(in oklab, ${c.color} ${strength}%, transparent)` } : undefined}
                        >
                          {over ? (
                            <span
                              className="absolute top-1 start-1 size-1.5 rounded-full bg-[var(--status-over)]"
                              aria-label={t("overBudgetShort")}
                            />
                          ) : null}
                          {num(v)}
                        </button>
                      </td>
                    );
                  })}
                  <td className="ps-3 text-end text-muted-foreground">{num(average)}</td>
                  <td className="ps-1 text-end">
                    <BudgetEditPopover
                      categoryId={c.categoryId}
                      categoryName={c.label}
                      amount={c.monthlyBudget > 0 ? c.monthlyBudget : null}
                      trigger={
                        <button
                          type="button"
                          title={t("editBudget", { name: c.label })}
                          className={cn(
                            "rounded-md px-1.5 py-1 underline-offset-2 hover:bg-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            c.monthlyBudget > 0 ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {c.monthlyBudget > 0 ? num(c.monthlyBudget) : t("gridSetBudget")}
                        </button>
                      }
                    />
                  </td>
                  <td className="ps-1 text-end font-medium">{num(c.total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {showUncategorized ? (
              <tr className="text-muted-foreground">
                <th scope="row" className="sticky start-0 z-10 bg-card pe-3 py-1 text-start text-sm font-normal">
                  {t("uncategorized")}
                </th>
                {periods.map((p) => (
                  <td key={p.from} className="px-2 text-end">{num(p.uncategorized)}</td>
                ))}
                <td className="ps-3 text-end">{num(periods.reduce((s, p) => s + (p.inProgress ? 0 : p.uncategorized), 0) / fullCount)}</td>
                <td />
                <td className="ps-1 text-end">{num(uncategorized)}</td>
              </tr>
            ) : null}
            <tr className="font-medium">
              <th scope="row" className="sticky start-0 z-10 border-t border-border bg-card pe-3 pt-2 text-start text-sm">
                {t("gridSpent")}
              </th>
              {periods.map((p) => (
                <td key={p.from} className="border-t border-border px-2 pt-2 text-end">{num(p.spent)}</td>
              ))}
              <td className="border-t border-border ps-3 pt-2 text-end">
                {num(periods.reduce((s, p) => s + (p.inProgress ? 0 : p.spent), 0) / fullCount)}
              </td>
              <td className="border-t border-border ps-1 pt-2 text-end" title={t("gridBudgetTotal")}>
                {num(totalBudget)}
              </td>
              <td className="border-t border-border ps-1 pt-2 text-end">{num(periods.reduce((s, p) => s + p.spent, 0))}</td>
            </tr>
            <tr className="text-muted-foreground">
              <th scope="row" className="sticky start-0 z-10 bg-card pe-3 py-1 text-start text-sm font-normal">
                {t("gridIncome")}
              </th>
              {periods.map((p) => (
                <td key={p.from} className="px-2 text-end">{num(p.income)}</td>
              ))}
              <td className="ps-3 text-end">{num(periods.reduce((s, p) => s + (p.inProgress ? 0 : p.income), 0) / fullCount)}</td>
              <td />
              <td className="ps-1 text-end">{num(periods.reduce((s, p) => s + p.income, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[var(--status-over)]" aria-hidden />
          {t("overBudgetLegend")}
        </span>
        {categories.length > GRID_ROWS ? (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? t("showFewer") : t("showAll", { count: categories.length })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

