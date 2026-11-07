import { NextResponse } from "next/server";
import {
  getPeriodTotal,
  getTopMerchants,
} from "@/server/db/queries/transactions";
import {
  getBankHealth,
  getCashFlow,
  getCategorySnapshot,
  getHistoricalTrend,
  getNeedsAttentionCounts,
  getRecentTransactionsForHome,
} from "@/server/db/queries/home";
import { getPeriodStartDay, getWorkspaceSetting } from "@/server/db/queries/settings";
import { getNextRunAt } from "@/server/sync/scheduler";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { daysUntil, nextPayday, pacePhrase } from "@/server/lib/pace";
import {
  dayOfPeriod,
  periodContaining,
  periodLength,
  periodMonthName,
  periodRange,
  shiftPeriod,
  toISODay,
} from "@/lib/period";
import type {
  HomeBankHealthItem,
  HomeCashFlow,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeNeedsAttention,
  HomePayload,
  HomeRecentTransaction,
  HomeSection,
  HomeSectionError,
  HomeThisMonth,
  HomeTopMerchant,
} from "@/lib/types";
import { withRequestScope } from "@/server/lib/scope";

const HISTORICAL_MONTHS = 8;
const RECENT_TXN_LIMIT = 8;
const TOP_MERCHANT_LIMIT = 6;
const CATEGORY_SNAPSHOT_LIMIT = 6;

function safe<T>(
  section: HomeSection,
  errors: HomeSectionError[],
  fn: () => T
): T | null {
  try {
    return fn();
  } catch (err) {
    errors.push({
      section,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function handleGET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);

  const now = new Date();
  // A calendar month, or payday to payday when the user budgets that way.
  const startDay = getPeriodStartDay(workspaceId);
  const period = periodContaining(now, startDay);
  const { from, to } = periodRange(period);
  const monthLabel = periodMonthName(period, "en");

  const totalDays = periodLength(period);
  const elapsedDays = Math.max(1, dayOfPeriod(period, now));
  const timeElapsedPercent = Math.min(100, (elapsedDays / totalDays) * 100);

  const paydayDay = Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1");
  const payday = nextPayday(now, paydayDay);
  const daysUntilPayday = Math.max(0, daysUntil(payday));

  const errors: HomeSectionError[] = [];

  const thisMonth = safe<HomeThisMonth>("thisMonth", errors, () => {
    const spent = getPeriodTotal(workspaceId, from, to);
    const monthlyTargetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
    const parsed = monthlyTargetRaw != null ? Number(monthlyTargetRaw) : NaN;
    const budget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    // Same window last period: its first day up to today's day number
    // (clamped), so a partial period is never compared against a full one.
    const prev = shiftPeriod(period, -1, startDay);
    const prevElapsedDay = Math.min(elapsedDays, periodLength(prev));
    const prevSameDaysEnd = new Date(
      prev.start.getFullYear(),
      prev.start.getMonth(),
      prev.start.getDate() + prevElapsedDay - 1
    );
    const prevFrom = toISODay(prev.start);
    const prevSpent = getPeriodTotal(workspaceId, prevFrom, toISODay(prevSameDaysEnd));
    const hasHistory = getPeriodTotal(workspaceId, prevFrom, toISODay(prev.end)) > 0;

    const projected = Math.max(spent, (spent / elapsedDays) * totalDays);
    const expectedByToday = budget > 0 ? (budget * elapsedDays) / totalDays : 0;
    let paceStatus: HomeThisMonth["paceStatus"] = null;
    if (budget > 0) {
      // Same rule as the Budget page hero (computeVerdict in hero-card.tsx):
      // warn once spending runs 25+ points ahead of the calendar. A straight
      // line forecast overreacts early in the month, when rent and other big
      // bills land first.
      const delta = (spent / budget) * 100 - timeElapsedPercent;
      if (spent > budget) paceStatus = "over";
      else if (delta >= 25) paceStatus = "ahead";
      else paceStatus = "on";
    }

    const phrase = pacePhrase(spent, spent, budget, timeElapsedPercent, monthLabel);

    return {
      spent,
      budget,
      pacePhrase: phrase,
      daysUntilPayday,
      timeElapsedPercent,
      monthLabel,
      periodStart: from,
      dayOfPeriod: elapsedDays,
      periodLength: totalDays,
      expectedByToday,
      projected,
      paceStatus,
      lastPeriodSameDays: hasHistory ? prevSpent : null,
      lastPeriodStart: prevFrom,
    };
  });

  const cashFlow = safe<HomeCashFlow>("cashFlow", errors, () =>
    getCashFlow(workspaceId, from, to)
  );

  const categorySnapshot = safe<HomeCategorySnapshotItem[]>(
    "categorySnapshot",
    errors,
    () => getCategorySnapshot(workspaceId, from, to, CATEGORY_SNAPSHOT_LIMIT)
  );

  const historicalTrend = safe<HomeHistoricalTrendPoint[]>(
    "historicalTrend",
    errors,
    () => getHistoricalTrend(workspaceId, HISTORICAL_MONTHS, startDay)
  );

  const recentTransactions = safe<HomeRecentTransaction[]>(
    "recentTransactions",
    errors,
    () => getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT)
  );

  const topMerchants = safe<HomeTopMerchant[]>("topMerchants", errors, () => {
    const rows = getTopMerchants(workspaceId, from, to, TOP_MERCHANT_LIMIT);
    return rows.map((m) => ({
      name: m.name,
      total: m.amount,
      count: m.count,
    }));
  });

  const needsAttention = safe<HomeNeedsAttention>(
    "needsAttention",
    errors,
    () => getNeedsAttentionCounts(workspaceId)
  );

  const bankHealth = safe<HomeBankHealthItem[]>("bankHealth", errors, () =>
    getBankHealth(workspaceId)
  );

  const payload: HomePayload = {
    thisMonth,
    cashFlow,
    categorySnapshot,
    historicalTrend,
    recentTransactions,
    topMerchants,
    needsAttention,
    bankHealth,
    nextScheduledSync: getNextRunAt(),
    errors,
  };

  return NextResponse.json(payload);
}

/** Every total in this route follows the budget scope (bank bundles) the client picked. */
export async function GET(...args: Parameters<typeof handleGET>) {
  const [request] = args;
  return withRequestScope(request, getWorkspaceIdFromRequest(request), () => handleGET(...args));
}
