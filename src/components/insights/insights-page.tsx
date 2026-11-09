"use client";

import { useAccess } from "@/components/access-provider";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";
import { CardSkeleton } from "@/components/home/card-shell";
import { Button } from "@/components/ui/button";
import { getInsights } from "@/lib/api";
import { CommittedCard, ForecastCard } from "./forecast-cards";
import { InsightFeed } from "./insight-feed";
import {
  BudgetSuggestionsCard,
  FeesCard,
  IncomeCard,
  MergeCard,
  RecapCard,
  RecurringCard,
  UpcomingCard,
} from "./insight-sections";

// One shrinkable column on phones, so long merchant names truncate instead of widening the page.
const ROW = "grid grid-cols-[minmax(0,1fr)] gap-4 md:gap-5 lg:gap-6";
/** Below this much history, results are thin and the page says so. */
const THIN_HISTORY_DAYS = 90;

export function InsightsPage() {
  useAmountsHidden();
  const t = useTranslations("insights");
  const { readOnly } = useAccess();
  const query = useQuery({ queryKey: ["insights"], queryFn: getInsights });
  const data = query.data;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label={t("refresh")}
            title={t("refresh")}
          >
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
          </Button>
        }
      />
      <div className="p-4 md:p-6 lg:p-8">
        {query.isError ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{t("error")}</p>
        ) : !data ? (
          <div className="flex flex-col gap-4 md:gap-5 lg:gap-6">
            <div className={`${ROW} lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
              <CardSkeleton height={220} />
              <CardSkeleton height={220} />
            </div>
            <CardSkeleton height={320} />
          </div>
        ) : (
          <div className="flex flex-col gap-4 md:gap-5 lg:gap-6">
            {data.historyDays < THIN_HISTORY_DAYS ? (
              <p className="rounded-xl border border-border bg-card px-5 py-3.5 text-[13px] text-muted-foreground">
                {t("thinHistory", { days: data.historyDays })}
              </p>
            ) : null}
            <div className={`${ROW} lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
              {data.forecast ? <ForecastCard data={data.forecast} upcoming={data.upcoming} /> : null}
              <div id="committed" className="min-w-0 scroll-mt-24">
                <CommittedCard periods={data.committed} />
              </div>
            </div>
            <div className={`${ROW} lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]`}>
              <InsightFeed feed={data.feed} hiddenCount={data.hiddenCount} aiProvider={data.ai.provider} />
              <div id="upcoming" className="min-w-0 scroll-mt-24">
                <UpcomingCard items={data.upcoming} />
              </div>
            </div>
            <div id="recurring" className="min-w-0 scroll-mt-24">
              <RecurringCard series={data.recurring} />
            </div>
            <div className={`${ROW} md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]`}>
              {data.recap ? <RecapCard recap={data.recap} /> : null}
              <div id="fees" className="min-w-0 scroll-mt-24">
                <FeesCard fees={data.fees} />
              </div>
              {data.income ? <IncomeCard income={data.income} /> : null}
            </div>
            {!readOnly && (data.budgetSuggestions.length > 0 || data.mergeSuggestions.length > 0) ? (
              <div className={`${ROW} md:grid-cols-[repeat(2,minmax(0,1fr))]`}>
                {data.budgetSuggestions.length > 0 ? (
                  <div id="budgets" className="min-w-0 scroll-mt-24">
                    <BudgetSuggestionsCard items={data.budgetSuggestions} />
                  </div>
                ) : null}
                {data.mergeSuggestions.length > 0 ? (
                  <div id="merge" className="min-w-0 scroll-mt-24">
                    <MergeCard items={data.mergeSuggestions} />
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="text-center text-[11.5px] text-muted-foreground">{t("footer")}</p>
          </div>
        )}
      </div>
    </>
  );
}
