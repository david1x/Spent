import "server-only";

import { getDb } from "../db";
import { getAppSettings, getPeriodStartDay, getSetting } from "../db/queries/settings";
import { getAllBudgets, getAutoBudgetAverage } from "../db/queries/budgets";
import { periodContaining, toISODay } from "@/lib/period";
import type { Insight, InsightsPayload, RecurringSeries } from "@/lib/insights-types";
import { HISTORY_DAYS, type InsightRow, loadInsightRows } from "./data";
import { buildMerchantKeys } from "./merchant";
import { detectRecurring } from "./recurring";
import { activePlans, committedPeriods, upcomingCharges } from "./plans";
import {
  budgetPace,
  budgetSuggestions,
  type CategoryCatalog,
  type CycleContext,
  computeForecast,
  computeRecap,
  unusualCategories,
} from "./cycles";
import { feesSummary, findDuplicates, incomeInfo, largeCharges, mergeSuggestions, recentRefunds } from "./signals";
import { loadFeedback } from "./feedback";
import { loadOverrides } from "./overrides";
import { daysBetween } from "./math";

/** Alerts outrank news of the same size. */
const SEVERITY_WEIGHT: Record<Insight["severity"], number> = { alert: 1.5, warn: 1.2, info: 0.8, good: 0.7 };

const PER_YEAR: Record<RecurringSeries["cadence"], number> = {
  weekly: 52,
  monthly: 12,
  bimonthly: 6,
  quarterly: 4,
  annual: 1,
};

function loadCatalog(workspaceId: number): CategoryCatalog {
  const rows = getDb()
    .prepare(
      `SELECT id, parent_id, name, color, kind, counts_in_spending, budget_mode
       FROM categories WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;
  const byId = new Map(
    rows.map((r) => [
      r.id as number,
      {
        id: r.id as number,
        parentId: (r.parent_id as number | null) ?? null,
        name: r.name as string,
        color: (r.color as string | null) ?? null,
        kind: r.kind as string,
        countsInSpending: r.counts_in_spending !== 0,
        budgetMode: (r.budget_mode as string | null) ?? null,
      },
    ])
  );
  const budgets = new Map<number, { amount: number; auto: boolean }>();
  for (const b of getAllBudgets(workspaceId)) budgets.set(b.categoryId, { amount: b.monthlyAmount, auto: b.isAuto });
  for (const a of getAutoBudgetAverage(workspaceId, 3)) {
    const cat = byId.get(a.categoryId);
    if (cat?.budgetMode === "budgeted" && cat.kind === "expense" && !budgets.has(a.categoryId)) {
      budgets.set(a.categoryId, { amount: a.amount, auto: true });
    }
  }
  return { byId, budgets };
}

function cardLabels(): Map<number, string> {
  const rows = getDb().prepare("SELECT id, label, provider FROM bank_credentials").all() as Array<{
    id: number;
    label: string | null;
    provider: string;
  }>;
  return new Map(rows.map((r) => [r.id, r.label?.trim() || r.provider]));
}

function aiProvider(): "claude" | "ollama" | null {
  const p = getSetting("ai_provider");
  if (p === "claude") return getSetting("ai_api_key_encrypted") ? "claude" : null;
  return p === "ollama" ? "ollama" : null;
}

/** Everything the Insights page shows, computed from local data. */
export function buildInsights(workspaceId: number, now = new Date()): InsightsPayload {
  const today = toISODay(now);
  const rows = loadInsightRows(workspaceId, now);
  const feedback = loadFeedback(workspaceId, now);
  const catalog = loadCatalog(workspaceId);
  const settings = getAppSettings(workspaceId);
  const startDay = getPeriodStartDay(workspaceId);
  const period = periodContaining(now, startDay);
  const historyStart = rows[0]?.day ?? today;

  const keys = buildMerchantKeys(workspaceId, rows.map((r) => r.description));
  const series = detectRecurring(rows, keys, {
    today,
    historyStart,
    excluded: feedback.notRecurring,
    overrides: loadOverrides(workspaceId),
  });
  const plans = activePlans(rows);

  // Rows that belong to a recurring expense or an installment plan.
  const fixedWhole = new Set<string>();
  const fixedAmounts = new Map<string, number[]>();
  for (const s of series) {
    if (s.direction !== "expense") continue;
    if (s.key.includes("@")) fixedAmounts.set(s.merchantKey, [...(fixedAmounts.get(s.merchantKey) ?? []), s.typical]);
    else fixedWhole.add(s.merchantKey);
  }
  const isFixed = (r: InsightRow): boolean => {
    if (r.isInstallment) return true;
    const k = keys.get(r.description) ?? r.description;
    if (fixedWhole.has(k)) return true;
    return (fixedAmounts.get(k) ?? []).some((a) => Math.abs(-r.amount - a) <= Math.max(2, 0.15 * a));
  };

  const ctx: CycleContext = { today, period, startDay, historyStart, isFixed };
  // Only budgets the user set; automatic ones are averages, not a plan.
  const budgetTotal = [...catalog.budgets.entries()]
    .filter(([id, b]) => !b.auto && catalog.byId.get(id)?.budgetMode === "budgeted" && catalog.byId.get(id)?.parentId === null)
    .reduce((s, [, b]) => s + b.amount, 0);
  const target = settings.monthlyTarget
    ? { amount: settings.monthlyTarget, source: "target" as const }
    : budgetTotal > 0
      ? { amount: budgetTotal, source: "budgets" as const }
      : null;

  const forecast = computeForecast(rows, ctx, series, plans, target);
  const committed = committedPeriods(period, startDay, plans, series, today);
  const upcoming = upcomingCharges(today, rows, plans, series, cardLabels());
  const fees = feesSummary(rows, keys, today);
  const recap = computeRecap(rows, ctx, catalog);
  const income = incomeInfo(rows, keys, series, today);
  const suggestions = budgetSuggestions(rows, ctx, catalog);
  const merges = mergeSuggestions(rows, keys, series, today, feedback.hidden);
  const refunds = recentRefunds(rows, keys, today);

  const all: Insight[] = [];
  const add = (i: Insight) => all.push({ ...i, score: Math.round(i.score * SEVERITY_WEIGHT[i.severity]) });
  const merchantLink = (name: string) => ({ search: name });

  // Recurring changes.
  for (const s of series) {
    if (s.direction !== "expense") continue;
    if (s.status === "charged_after_cancel" && s.chargedAfterCancel && s.cancelledAt) {
      add({
        id: `charged_after_cancel:${s.key}:${s.chargedAfterCancel.date}`,
        type: "charged_after_cancel",
        severity: "alert",
        score: s.chargedAfterCancel.amount * 4 + 400,
        params: {
          merchant: s.merchant,
          amount: s.chargedAfterCancel.amount,
          date: s.chargedAfterCancel.date,
          cancelledAt: s.cancelledAt,
        },
        link: { search: s.merchant, from: s.cancelledAt, to: today },
      });
    } else if (s.status === "changed" && s.change) {
      const up = s.change.to > s.change.from;
      const yearly = Math.abs(s.change.to - s.change.from) * PER_YEAR[s.cadence];
      add({
        id: `${up ? "price_up" : "price_down"}:${s.key}:${s.change.since}`,
        type: up ? "price_up" : "price_down",
        severity: up ? "warn" : "good",
        score: yearly * (up ? 1.5 : 0.6),
        params: { merchant: s.merchant, from: s.change.from, to: s.change.to, since: s.change.since, yearly: Math.round(yearly), cadence: s.cadence },
        link: merchantLink(s.merchant),
        feedback: { key: s.key, action: "not_recurring" },
      });
    } else if (s.status === "new" && s.counted) {
      add({
        id: `new_recurring:${s.key}`,
        type: "new_recurring",
        severity: "info",
        // Two charges are a hint, not a pattern; and a year of a new charge
        // is a projection, so it weighs a few months at most.
        score: Math.min(s.annual, s.typical * 4) * (s.occurrences >= 3 ? 0.9 : 0.35),
        params: { merchant: s.merchant, amount: s.typical, cadence: s.cadence, yearly: Math.round(s.annual), since: s.firstDate },
        link: merchantLink(s.merchant),
        feedback: { key: s.key, action: "not_recurring" },
      });
    } else if (s.status === "missing" && s.counted && s.typical >= 20) {
      add({
        id: `missing_recurring:${s.key}:${s.nextExpected}`,
        type: "missing_recurring",
        severity: "info",
        score: s.typical * 1.2 + 40,
        params: { merchant: s.merchant, amount: s.typical, expected: s.nextExpected, last: s.lastDate, cadence: s.cadence },
        link: merchantLink(s.merchant),
        feedback: { key: s.key, action: "not_recurring" },
      });
    }
  }

  for (const d of findDuplicates(rows, keys, today)) {
    add({
      id: `duplicate:${d.a.id}-${d.b.id}`,
      type: "duplicate",
      severity: "alert",
      score: -d.b.amount * 3 + 200,
      params: { merchant: d.b.description, amount: -d.b.amount, first: d.a.day, second: d.b.day },
      link: { search: d.b.description, from: d.a.day, to: d.b.day },
    });
  }

  if (forecast && forecast.target !== null && forecast.dayOfPeriod >= 5) {
    const over = forecast.mid - forecast.target;
    // Against a plan, a small overshoot matters; against "typical" only a big one.
    const planned = forecast.targetSource !== "typical";
    if (planned ? forecast.mid > forecast.target * 1.03 : forecast.mid > forecast.target * 1.25 && over >= 1000) {
      add({
        id: `forecast_over:${forecast.periodStart}`,
        type: "forecast_over",
        severity: forecast.low > forecast.target ? "alert" : "warn",
        score: over * 2.5 + 300,
        params: { low: forecast.low, high: forecast.high, target: forecast.target, end: forecast.periodEnd, over: Math.round(over), source: forecast.targetSource },
      });
    } else if (planned && forecast.high < forecast.target * 0.92 && forecast.dayOfPeriod >= 10) {
      add({
        id: `forecast_under:${forecast.periodStart}`,
        type: "forecast_under",
        severity: "good",
        score: (forecast.target - forecast.high) * 0.4,
        params: { low: forecast.low, high: forecast.high, target: forecast.target, end: forecast.periodEnd },
      });
    }
  }

  for (const b of budgetPace(rows, ctx, catalog)) {
    add({
      id: `budget_pace:${b.categoryId}:${forecast?.periodStart ?? today}`,
      type: "budget_pace",
      severity: b.over ? "alert" : "warn",
      score: (b.projected - b.budget) * 2 + 150,
      params: { category: b.name, budget: b.budget, spent: b.spent, projected: b.projected, over: b.over ? 1 : 0 },
      link: { categoryId: b.categoryId, from: forecast?.periodStart, to: forecast?.periodEnd },
    });
  }

  const paced = new Set(all.filter((i) => i.type === "budget_pace").map((i) => i.link?.categoryId));
  for (const u of unusualCategories(rows, ctx, catalog)) {
    const key = `category:${u.categoryId}`;
    // A budget warning on the same category already says it.
    if (feedback.notUnusual.has(key) || paced.has(u.categoryId)) continue;
    add({
      id: `unusual_category:${u.categoryId}:${forecast?.periodStart ?? today}`,
      type: "unusual_category",
      severity: "warn",
      score: u.excess * 1.8,
      params: { category: u.name, amount: u.amount, typical: u.typical, excess: u.excess },
      link: { categoryId: u.categoryId, from: forecast?.periodStart, to: today },
      feedback: { key, action: "not_unusual" },
    });
  }

  for (const l of largeCharges(rows, keys, today, isFixed)) {
    const key = `txn:${l.row.id}`;
    if (feedback.notUnusual.has(key)) continue;
    add({
      id: `large_charge:${l.row.id}`,
      type: "large_charge",
      severity: "info",
      score: -l.row.amount * 0.5,
      params: { merchant: l.row.description, amount: -l.row.amount, date: l.row.day, firstTime: l.firstTime ? 1 : 0, category: l.row.categoryName },
      link: { search: l.row.description, from: l.row.day, to: l.row.day },
      feedback: { key, action: "not_unusual" },
    });
  }

  if (income?.status === "late") {
    add({
      id: `salary_late:${today.slice(0, 7)}`,
      type: "salary_late",
      severity: "warn",
      score: income.typical * 0.5 + 300,
      params: { merchant: income.merchant, day: income.expectedDay, typical: income.typical },
    });
  }
  if (income?.change != null && income.status === "received" && daysBetween(income.lastDate, today) <= 25) {
    add({
      id: `salary_changed:${income.lastDate}`,
      type: "salary_changed",
      severity: income.change > 0 ? "good" : "info",
      score: Math.abs(income.last - income.typical) * 3,
      params: { merchant: income.merchant, last: income.last, typical: income.typical, change: income.change },
      link: merchantLink(income.merchant),
    });
  }

  const ahead = committed.filter((c) => !c.current);
  const next = ahead[0];
  const following = ahead[1];
  if (next && following) {
    const ending = next.plans.filter((p) => p.remaining === 0);
    const freed = ending.reduce((s, p) => s + p.amount, 0);
    if (ending.length > 0 && freed >= 50) {
      add({
        id: `installments_ending:${next.periodStart}`,
        type: "installments_ending",
        severity: "good",
        score: freed * 0.8,
        params: { count: ending.length, freed: Math.round(freed), from: following.periodStart },
        link: { anchor: "committed" },
      });
    }
  }

  if (fees.total12m >= 120) {
    add({
      id: `fees:${today.slice(0, 7)}`,
      type: "fees",
      severity: "info",
      score: fees.total12m * 0.6,
      params: { total: Math.round(fees.total12m), lines: fees.lines.length, top: fees.lines[0]?.merchant ?? null },
      link: { anchor: "fees" },
    });
  }

  if (suggestions.length >= 2) {
    add({
      id: "budget_suggest",
      type: "budget_suggest",
      severity: "info",
      score: 160,
      params: { count: suggestions.length, total: suggestions.reduce((s, x) => s + x.suggested, 0) },
      link: { anchor: "budgets" },
    });
  }

  for (const r of refunds.slice(0, 2)) {
    add({
      id: `refund:${r.id}`,
      type: "refund",
      severity: "good",
      score: r.amount * 0.3,
      params: { merchant: r.merchant, amount: r.amount, date: r.date },
      link: { search: r.merchant, from: r.date, to: r.date },
    });
  }

  for (const m of merges.slice(0, 1)) {
    add({
      id: `merge:${[m.a.key, m.b.key].sort().join("|")}`,
      type: "merchant_merge",
      severity: "info",
      score: 60,
      params: { a: m.a.name, b: m.b.name },
      link: { anchor: "merge" },
    });
  }

  const visible = all.filter((i) => !feedback.hidden.has(i.id)).sort((a, b) => b.score - a.score);
  return {
    generatedAt: now.toISOString(),
    historyDays: Math.min(HISTORY_DAYS, daysBetween(historyStart, today)),
    forecast,
    committed,
    feed: visible,
    hiddenCount: all.length - visible.length,
    recurring: series,
    upcoming,
    fees,
    recap,
    income,
    budgetSuggestions: suggestions,
    mergeSuggestions: merges,
    refunds,
    ai: { provider: aiProvider() },
  };
}
