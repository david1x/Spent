"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { getSummary } from "@/lib/api";
import { addMonths } from "@/lib/formatters";
import { PageHeader } from "@/components/layout/app-shell";
import { HeroCard } from "./hero-card";
import { CategoryGrid } from "./category-grid";
import { SpendingSunburst } from "./spending-sunburst";
import { PeriodSelector } from "./period-selector";
import { SyncControl } from "@/components/layout/sync-control";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CategoryViewMode } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";
import { useBudgetPeriod } from "@/components/layout/use-budget-period";

const VIEW_MODE_KEY = "spent.dashboard.viewMode";

function readViewMode(): CategoryViewMode {
  if (typeof window === "undefined") return "collapsed";
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_KEY);
    return raw === "expanded" ? "expanded" : "collapsed";
  } catch {
    return "collapsed";
  }
}

export function Dashboard() {
  // Re-render everything below when "Hide amounts" flips; the formatters read it.
  useAmountsHidden();
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<CategoryViewMode>("collapsed");

  useEffect(() => {
    setViewMode(readViewMode());
  }, []);

  const handleViewModeChange = useCallback((mode: CategoryViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage may be unavailable; in-memory state still works.
    }
  }, []);

  const { from, to, label: monthLabel } = useBudgetPeriod(selectedDate, locale);

  const summaryQuery = useQuery({
    queryKey: ["summary", from, to],
    queryFn: () => getSummary({ from, to }),
  });

  const summary = summaryQuery.data;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        meta={monthLabel}
        actions={
          <>
            <PeriodSelector
              label={monthLabel}
              onPrev={() => setSelectedDate((d) => addMonths(d, -1))}
              onNext={() => setSelectedDate((d) => addMonths(d, 1))}
            />
            <SyncControl />
          </>
        }
      />

      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        <HeroCard
          data={summary}
          loading={summaryQuery.isLoading}
          monthLabel={monthLabel}
        />

        <SpendingSunburst
          categories={summary?.categoriesWithData ?? []}
          loading={summaryQuery.isLoading}
          from={from}
          to={to}
        />

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
      </div>
    </>
  );
}
