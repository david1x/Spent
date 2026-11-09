"use client";

import { useState, useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { getSummary } from "@/lib/api";
import { addMonths } from "@/lib/formatters";
import { PageHeader } from "@/components/layout/app-shell";
import { HeroCard } from "./hero-card";
import { CategoryGrid } from "./category-grid";
import { SpendingSunburst } from "./spending-sunburst";
import { SpendingChanges } from "./spending-changes";
import { PeriodSelector } from "./period-selector";
import {
  DEFAULT_TREND_RANGE,
  SpendingTrendView,
  TrendRangePicker,
  trendSpan,
  type TrendRange,
} from "./spending-trend";
import { SyncControl } from "@/components/layout/sync-control";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CategoryViewMode } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";
import { useBudgetPeriod } from "@/components/layout/use-budget-period";
import { formatRangeLabel, periodRange } from "@/lib/period";

const VIEW_MODE_KEY = "spent.dashboard.viewMode";
const PAGE_VIEW_KEY = "spent.budgets.view";
const TREND_RANGE_KEY = "spent.budgets.trendRange";

type PageView = "month" | "trend";

/** Same-tab writes don't fire "storage", so writers announce themselves. */
const STORED_EVENT = "spent:stored";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remembered per browser. When storage is blocked the choice holds in memory until reload. */
const memory = new Map<string, string>();

function writeStored(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Kept in memory instead.
  }
  window.dispatchEvent(new Event(STORED_EVENT));
}

function subscribeStored(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORED_EVENT, onChange);
  };
}

/** A remembered choice. The server render gets the fallback, then the browser's value. */
function useStored<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  const raw = useSyncExternalStore(
    subscribeStored,
    () => readRaw(key) ?? memory.get(key) ?? null,
    () => null
  );
  // parse and fallback are module-level constants at every call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw != null ? parse(raw) : null) ?? fallback, [raw]);
}

const parseViewMode = (r: string): CategoryViewMode => (r === "expanded" ? "expanded" : "collapsed");
const parsePageView = (r: string): PageView => (r === "trend" ? "trend" : "month");

function parseTrendRange(raw: string): TrendRange | null {
  try {
    const v = JSON.parse(raw) as TrendRange;
    if (v.kind === "last" && [6, 12, 24].includes(v.count)) return v;
    if (v.kind === "year" && Number.isInteger(v.year)) return v;
    if (v.kind === "custom" && /^\d{4}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}$/.test(v.to)) return v;
  } catch {
    // Fall through to the default.
  }
  return null;
}


export function Dashboard() {
  // Re-render everything below when "Hide amounts" flips; the formatters read it.
  useAmountsHidden();
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const viewMode = useStored(VIEW_MODE_KEY, parseViewMode, "collapsed");
  const pageView = useStored(PAGE_VIEW_KEY, parsePageView, "month");
  const trendRange = useStored(TREND_RANGE_KEY, parseTrendRange, DEFAULT_TREND_RANGE);

  const changePageView = (view: PageView) => writeStored(PAGE_VIEW_KEY, view);
  const changeTrendRange = (range: TrendRange) =>
    writeStored(TREND_RANGE_KEY, JSON.stringify(range));
  const handleViewModeChange = useCallback(
    (mode: CategoryViewMode) => writeStored(VIEW_MODE_KEY, mode),
    []
  );

  const { from, to, label: monthLabel, startDay } = useBudgetPeriod(selectedDate, locale);
  const trend = pageView === "trend";
  const span = trendSpan(trendRange, startDay);
  const trendDays = periodRange(span);
  const trendLabel = formatRangeLabel(span.start, span.end, locale);

  const summaryQuery = useQuery({
    queryKey: ["summary", from, to],
    queryFn: () => getSummary({ from, to }),
    enabled: !trend,
  });

  const summary = summaryQuery.data;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        meta={trend ? trendLabel : monthLabel}
        actions={
          <>
            <Tabs value={pageView} onValueChange={(v) => changePageView(v === "trend" ? "trend" : "month")}>
              <TabsList>
                <TabsTrigger value="month">{t("viewMonth")}</TabsTrigger>
                <TabsTrigger value="trend">{t("viewTrend")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {trend ? (
              <TrendRangePicker
                key={JSON.stringify(trendRange)}
                range={trendRange}
                onChange={changeTrendRange}
                label={trendLabel}
                startDay={startDay}
              />
            ) : (
              <PeriodSelector
                label={monthLabel}
                onPrev={() => setSelectedDate((d) => addMonths(d, -1))}
                onNext={() => setSelectedDate((d) => addMonths(d, 1))}
              />
            )}
            <SyncControl />
          </>
        }
      />

      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        {trend ? (
          <SpendingTrendView
            from={trendDays.from}
            to={trendDays.to}
            onOpenMonth={(day) => {
              setSelectedDate(day);
              changePageView("month");
            }}
          />
        ) : (
        <>
        <HeroCard
          data={summary}
          loading={summaryQuery.isLoading}
          monthLabel={monthLabel}
        />

        <div className="grid gap-6 min-[1400px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <SpendingSunburst
            categories={summary?.categoriesWithData ?? []}
            loading={summaryQuery.isLoading}
            from={from}
            to={to}
          />
          <SpendingChanges
            changes={summary?.changes}
            loading={summaryQuery.isLoading}
            from={from}
            to={to}
          />
        </div>

        <div className="flex items-center justify-end">
          <Tabs
            value={viewMode}
            onValueChange={(v) =>
              handleViewModeChange(v === "expanded" ? "expanded" : "collapsed")
            }
          >
            <TabsList>
              <TabsTrigger value="collapsed">{t("viewModeGrouped")}</TabsTrigger>
              <TabsTrigger value="expanded">{t("viewModeAll")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <CategoryGrid
          categories={summary?.categoriesWithData ?? []}
          loading={summaryQuery.isLoading}
          periodTotal={summary?.periodTotal ?? 0}
          from={from}
          to={to}
          viewMode={viewMode}
        />
        </>
        )}
      </div>
    </>
  );
}
