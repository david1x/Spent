"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getHome } from "@/lib/api";
import { PageHeader } from "@/components/layout/app-shell";
import { SyncControl } from "@/components/layout/sync-control";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { ThisMonthCard } from "./this-month-card";
import { CashFlowCard } from "./cash-flow-card";
import { CategorySnapshotCard } from "./category-snapshot-card";
import { HistoricalTrendCard } from "./historical-trend-card";
import { RecentTransactionsCard } from "./recent-transactions-card";
import { NeedsAttentionCard } from "./needs-attention-card";
import { BankHealthCard } from "./bank-health-card";
import { SyncFailureBanner } from "./sync-failure-banner";
import { CardError, CardSkeleton } from "./card-shell";
import type { HomePayload, HomeSection } from "@/lib/types";
import { TopInsightCard } from "./top-insight-card";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";

type CardSection = Exclude<HomeSection, "topMerchants">;

const ROW_GAP = "grid gap-4 md:gap-5 lg:gap-6";

export function HomePage() {
  // Re-render everything below when "Hide amounts" flips; the formatters read it.
  useAmountsHidden();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [autoStartSync] = useState(() => searchParams.get("sync") === "1");
  const t = useTranslations("home");
  const skeletonLabels = useMemo<Record<CardSection, string>>(
    () => ({
      thisMonth: t("spentSoFar"),
      cashFlow: t("moneyInAndOut"),
      categorySnapshot: t("whereItWent"),
      historicalTrend: t("last8Months"),
      recentTransactions: t("recentActivity"),
      needsAttention: t("toReview"),
      bankHealth: t("banks"),
    }),
    [t]
  );

  useEffect(() => {
    if (autoStartSync) {
      router.replace("/", { scroll: false });
    }
  }, [autoStartSync, router]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
  });

  const section = (name: CardSection) =>
    renderSection(name, data, isLoading, isError, skeletonLabels);

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={<SyncControl autoStart={autoStartSync} />}
      />

      <div className="p-4 md:p-6 lg:p-8">
        <SyncFailureBanner
          items={data?.bankHealth ?? null}
          className="mb-4 md:mb-5 lg:mb-6"
        />
        <AINotConnectedBanner className="mb-4 md:mb-5 lg:mb-6" />
        <div className="flex flex-col gap-4 md:gap-5 lg:gap-6">
          <div className={`${ROW_GAP} lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]`}>
            {section("thisMonth")}
            {section("cashFlow")}
          </div>
          <div className={`${ROW_GAP} lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]`}>
            {section("categorySnapshot")}
            {section("historicalTrend")}
          </div>
          <div className={`${ROW_GAP} lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]`}>
            {section("recentTransactions")}
            <div className="flex min-w-0 flex-col gap-4 md:gap-5 lg:gap-6">
              <TopInsightCard />
              {section("needsAttention")}
              {section("bankHealth")}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function renderSection(
  section: CardSection,
  data: HomePayload | undefined,
  isLoading: boolean,
  isError: boolean,
  skeletonLabels: Record<CardSection, string>
) {
  if (isLoading || !data) {
    return (
      <div key={section} className="min-w-0">
        <CardSkeleton label={skeletonLabels[section]} height={SKELETON_HEIGHTS[section]} />
      </div>
    );
  }

  const sectionHasError =
    isError || data.errors.some((e) => e.section === section);

  return (
    <div key={section} className="min-w-0">
      {sectionHasError ? (
        <CardError label={skeletonLabels[section]} />
      ) : (
        renderCard(section, data)
      )}
    </div>
  );
}

function renderCard(section: CardSection, data: HomePayload) {
  switch (section) {
    case "thisMonth":
      return data.thisMonth ? <ThisMonthCard data={data.thisMonth} /> : null;
    case "cashFlow":
      return data.cashFlow ? <CashFlowCard data={data.cashFlow} /> : null;
    case "categorySnapshot":
      return data.categorySnapshot ? (
        <CategorySnapshotCard
          items={data.categorySnapshot}
          totalSpent={data.thisMonth?.spent ?? null}
          elapsedPercent={data.thisMonth?.timeElapsedPercent ?? null}
        />
      ) : null;
    case "historicalTrend":
      return data.historicalTrend ? (
        <HistoricalTrendCard
          data={data.historicalTrend}
          budget={data.thisMonth?.budget ?? 0}
          projected={data.thisMonth?.projected ?? null}
        />
      ) : null;
    case "recentTransactions":
      return data.recentTransactions ? (
        <RecentTransactionsCard items={data.recentTransactions} />
      ) : null;
    case "needsAttention":
      return data.needsAttention ? (
        <NeedsAttentionCard data={data.needsAttention} />
      ) : null;
    case "bankHealth":
      return data.bankHealth ? (
        <BankHealthCard items={data.bankHealth} />
      ) : null;
  }
}

const SKELETON_HEIGHTS: Record<CardSection, number> = {
  thisMonth: 200,
  cashFlow: 200,
  categorySnapshot: 280,
  historicalTrend: 260,
  recentTransactions: 320,
  needsAttention: 60,
  bankHealth: 160,
};
