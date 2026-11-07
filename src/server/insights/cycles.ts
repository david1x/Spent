import "server-only";

import type { InsightRow } from "./data";
import type {
  BudgetSuggestion,
  CycleRecap,
  ForecastRange,
  RecapDriver,
  RecurringSeries,
} from "@/lib/insights-types";
import { type Period, periodLength, shiftPeriod, toISODay } from "@/lib/period";
import { daysBetween, mad, median, quantile } from "./math";
import { type ActivePlan, isExpected, projectSeries } from "./plans";

/** Past periods the forecast and comparisons learn from. */
const LOOKBACK = 8;
/** A charge this big is a one-off; it doesn't set the pace for the rest of the period. */
const ONE_OFF = 1000;

export interface CycleContext {
  today: string;
  period: Period;
  startDay: number;
  /** First day of data; periods starting earlier are incomplete. */
  historyStart: string;
  /** Recurring charges and installments: predictable, so kept out of "variable". */
  isFixed: (row: InsightRow) => boolean;
}

interface PeriodSpan {
  from: string;
  to: string;
}

function span(p: Period): PeriodSpan {
  return { from: toISODay(p.start), to: toISODay(p.end) };
}

/** Counted money out (positive), completed rows, as Home totals it. */
function isSpend(r: InsightRow): boolean {
  return r.counted && r.amount < 0 && r.status === "completed";
}

/** Complete past periods with data from their first day. */
export function pastPeriods(ctx: CycleContext, count = LOOKBACK): PeriodSpan[] {
  const out: PeriodSpan[] = [];
  for (let i = 1; i <= count; i++) {
    const s = span(shiftPeriod(ctx.period, -i, ctx.startDay));
    if (s.from < ctx.historyStart) break;
    out.push(s);
  }
  return out;
}

function inSpan(r: InsightRow, s: PeriodSpan): boolean {
  return r.day >= s.from && r.day <= s.to;
}

export function computeForecast(
  rows: InsightRow[],
  ctx: CycleContext,
  series: RecurringSeries[],
  plans: ActivePlan[],
  target: { amount: number; source: "target" | "budgets" } | null
): ForecastRange | null {
  const cur = span(ctx.period);
  const length = periodLength(ctx.period);
  const day = Math.min(length, daysBetween(cur.from, ctx.today) + 1);
  const past = pastPeriods(ctx);

  const spent = sum(rows.filter((r) => isSpend(r) && r.day >= cur.from && r.day <= ctx.today), (r) => -r.amount);

  // Fixed charges still due this period.
  let fixedRemaining = 0;
  for (const s of series) {
    if (s.direction !== "expense" || !s.counted || !isExpected(s)) continue;
    fixedRemaining += projectSeries(s, cur.to).filter((d) => d > ctx.today).length * s.typical;
  }
  for (const plan of plans) {
    fixedRemaining += plan.payments.filter((p) => p.day > ctx.today && p.day <= cur.to).length * plan.perPayment;
  }

  // Variable spending in the rest of each past period, from the same day on.
  const variable = rows.filter((r) => isSpend(r) && !ctx.isFixed(r));
  const remainders: number[] = [];
  const soFarPast: number[] = [];
  for (const p of past) {
    let before = 0;
    let after = 0;
    for (const r of variable) {
      if (!inSpan(r, p)) continue;
      if (daysBetween(p.from, r.day) + 1 <= day) {
        if (-r.amount < ONE_OFF) before -= r.amount;
      } else after -= r.amount;
    }
    remainders.push(after);
    soFarPast.push(before);
  }
  const variableSoFar = sum(
    variable.filter((r) => r.day >= cur.from && r.day <= ctx.today),
    (r) => -r.amount
  );
  // One-off big charges say little about the rest of the period.
  const paceSoFar = sum(
    variable.filter((r) => r.day >= cur.from && r.day <= ctx.today && -r.amount < ONE_OFF),
    (r) => -r.amount
  );

  const totals = past.map((p) => sum(rows.filter((r) => isSpend(r) && inSpan(r, p)), (r) => -r.amount));
  const typical = totals.length >= 2 ? round(median(totals)) : null;

  let low: number;
  let mid: number;
  let high: number;
  if (remainders.length >= 3) {
    // A heavier start usually means a heavier finish; scale the past
    // remainders by this period's pace, within reason.
    const pastSoFar = median(soFarPast);
    const pace = pastSoFar > 0 ? clamp(paceSoFar / pastSoFar, 0.7, 1.4) : 1;
    low = quantile(remainders, 0.2) * pace;
    mid = quantile(remainders, 0.5) * pace;
    high = quantile(remainders, 0.8) * pace;
  } else {
    if (day < 3) return null;
    const linear = (variableSoFar / day) * (length - day);
    low = linear * 0.75;
    mid = linear;
    high = linear * 1.25;
  }
  const base = spent + fixedRemaining;
  const resolvedTarget = target ?? (typical !== null ? { amount: typical, source: "typical" as const } : null);
  return {
    periodStart: cur.from,
    periodEnd: cur.to,
    dayOfPeriod: day,
    periodLength: length,
    spent: round(spent),
    fixedRemaining: round(fixedRemaining),
    low: round(base + low),
    mid: round(base + mid),
    high: round(base + high),
    target: resolvedTarget ? round(resolvedTarget.amount) : null,
    targetSource: resolvedTarget?.source ?? null,
    typical,
    cyclesUsed: remainders.length,
    history: past
      .map((p, i) => ({ periodStart: p.from, periodEnd: p.to, total: round(totals[i] ?? 0) }))
      .reverse(),
  };
}

interface CategoryInfo {
  id: number;
  parentId: number | null;
  name: string;
  color: string | null;
  kind: string;
  countsInSpending: boolean;
  budgetMode: string | null;
}

export interface CategoryCatalog {
  byId: Map<number, CategoryInfo>;
  /** Explicit budgets, and automatic ones (3-month average) for budgeted categories without one. */
  budgets: Map<number, { amount: number; auto: boolean }>;
}

/** Spend per category over a span, optionally only up to day N of it. */
function categoryTotals(rows: InsightRow[], s: PeriodSpan, uptoDay?: number, onlyVariable?: (r: InsightRow) => boolean) {
  const totals = new Map<number, number>();
  for (const r of rows) {
    if (!isSpend(r) || r.categoryId === null || !inSpan(r, s)) continue;
    if (uptoDay !== undefined && daysBetween(s.from, r.day) + 1 > uptoDay) continue;
    if (onlyVariable && !onlyVariable(r)) continue;
    totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) - r.amount);
  }
  return totals;
}

/** The last complete period against the ones before it. */
export function computeRecap(rows: InsightRow[], ctx: CycleContext, catalog: CategoryCatalog): CycleRecap | null {
  const all = pastPeriods(ctx, 7);
  if (all.length === 0) return null;
  const [last, ...before] = all;
  const spendRows = rows.filter((r) => isSpend(r) && inSpan(r, last));
  const spent = sum(spendRows, (r) => -r.amount);
  const income = sum(
    rows.filter((r) => r.counted && r.amount > 0 && r.status === "completed" && inSpan(r, last)),
    (r) => r.amount
  );
  const priorTotals = before.map((p) => sum(rows.filter((r) => isSpend(r) && inSpan(r, p)), (r) => -r.amount));

  const lastByCat = categoryTotals(rows, last);
  const priorByCat = before.map((p) => categoryTotals(rows, p));
  const drivers: RecapDriver[] = [];
  if (before.length >= 2) {
    const ids = new Set<number>([...lastByCat.keys(), ...priorByCat.flatMap((m) => [...m.keys()])]);
    for (const id of ids) {
      const amount = lastByCat.get(id) ?? 0;
      const typical = median(priorByCat.map((m) => m.get(id) ?? 0));
      const delta = amount - typical;
      if (Math.abs(delta) < 100) continue;
      const cat = catalog.byId.get(id);
      drivers.push({ categoryId: id, name: cat?.name ?? null, color: cat?.color ?? null, amount: round(amount), typical: round(typical), delta: round(delta) });
    }
    drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  const biggest = spendRows
    .filter((r) => !r.isInstallment)
    .sort((a, b) => a.amount - b.amount)[0];
  return {
    periodStart: last.from,
    periodEnd: last.to,
    spent: round(spent),
    typical: priorTotals.length >= 2 ? round(median(priorTotals)) : null,
    income: round(income),
    net: round(income - spent),
    drivers: drivers.slice(0, 3),
    biggest: biggest ? { id: biggest.id, merchant: biggest.description, amount: round(-biggest.amount), date: biggest.day } : null,
  };
}

export interface UnusualCategory {
  categoryId: number;
  name: string;
  amount: number;
  typical: number;
  excess: number;
}

/**
 * Categories running well above their usual level by this day of the period.
 * Robust z-score (median and MAD, MAD floored so a steady category doesn't
 * trip on a small bump), plus a shekel and ratio floor.
 */
export function unusualCategories(rows: InsightRow[], ctx: CycleContext, catalog: CategoryCatalog): UnusualCategory[] {
  const cur = span(ctx.period);
  const day = daysBetween(cur.from, ctx.today) + 1;
  if (day < 5) return [];
  const past = pastPeriods(ctx, 6);
  if (past.length < 3) return [];
  const variable = (r: InsightRow) => !ctx.isFixed(r);
  const now = categoryTotals(rows, cur, day, variable);
  const prior = past.map((p) => categoryTotals(rows, p, day, variable));
  const out: UnusualCategory[] = [];
  for (const [id, amount] of now) {
    const values = prior.map((m) => m.get(id) ?? 0);
    const m = median(values);
    const spread = Math.max(mad(values), 0.1 * m, 50);
    const z = (0.6745 * (amount - m)) / spread;
    if (z > 3.5 && amount - m >= 300 && amount >= 1.5 * m) {
      const cat = catalog.byId.get(id);
      out.push({ categoryId: id, name: cat?.name ?? "", amount: round(amount), typical: round(m), excess: round(amount - m) });
    }
  }
  return out.sort((a, b) => b.excess - a.excess);
}

export interface BudgetPace {
  categoryId: number;
  name: string;
  budget: number;
  spent: number;
  projected: number;
  over: boolean;
}

/** Category ids under `id` (itself included), for parent-level budgets. */
function withChildren(id: number, catalog: CategoryCatalog): Set<number> {
  const ids = new Set([id]);
  for (const c of catalog.byId.values()) if (c.parentId === id) ids.add(c.id);
  return ids;
}

/** Budgeted categories on track to pass their budget. Quiet in the first days. */
export function budgetPace(rows: InsightRow[], ctx: CycleContext, catalog: CategoryCatalog): BudgetPace[] {
  const cur = span(ctx.period);
  const length = periodLength(ctx.period);
  const day = daysBetween(cur.from, ctx.today) + 1;
  const out: BudgetPace[] = [];
  for (const [id, { amount: budget, auto }] of catalog.budgets) {
    const cat = catalog.byId.get(id);
    if (!cat || cat.budgetMode !== "budgeted" || budget < 100) continue;
    // An automatic budget is an average, so only a clear overshoot counts.
    const margin = auto ? 1.25 : 1.1;
    const ids = withChildren(id, catalog);
    const spentRows = rows.filter((r) => isSpend(r) && r.categoryId !== null && ids.has(r.categoryId) && r.day >= cur.from && r.day <= ctx.today);
    // Fixed charges and one-offs count once; only everyday spending is
    // extrapolated to the end of the period.
    const once = (r: InsightRow) => ctx.isFixed(r) || -r.amount >= ONE_OFF;
    const fixed = sum(spentRows.filter(once), (r) => -r.amount);
    const variable = sum(spentRows.filter((r) => !once(r)), (r) => -r.amount);
    const spent = fixed + variable;
    const projected = fixed + (day > 0 ? (variable / day) * length : 0);
    if (Math.max(spent, projected) - budget < 100) continue;
    if (spent > budget * (auto ? 1.15 : 1)) out.push({ categoryId: id, name: cat.name, budget, spent: round(spent), projected: round(projected), over: true });
    else if (day >= 5 && projected > budget * margin && spent > budget * 0.5) {
      out.push({ categoryId: id, name: cat.name, budget, spent: round(spent), projected: round(projected), over: false });
    }
  }
  return out.sort((a, b) => b.projected - b.budget - (a.projected - a.budget));
}

/** Budgets drawn from typical spending, for categories that don't have one. */
export function budgetSuggestions(rows: InsightRow[], ctx: CycleContext, catalog: CategoryCatalog): BudgetSuggestion[] {
  const past = pastPeriods(ctx, 6);
  if (past.length < 3) return [];
  const perPeriod = past.map((p) => categoryTotals(rows, p));
  const out: BudgetSuggestion[] = [];
  for (const cat of catalog.byId.values()) {
    if (cat.kind !== "expense" || !cat.countsInSpending || cat.budgetMode === "budgeted") continue;
    // Leaves only; a parent's spending is its children's.
    if ([...catalog.byId.values()].some((c) => c.parentId === cat.id)) continue;
    const values = perPeriod.map((m) => m.get(cat.id) ?? 0);
    const active = values.filter((v) => v > 0).length;
    const m = median(values);
    if (active < 4 || m < 100) continue;
    out.push({
      categoryId: cat.id,
      name: cat.name,
      color: cat.color,
      suggested: Math.ceil((m * 1.05) / 50) * 50,
      median: round(m),
      activeCycles: active,
    });
  }
  return out.sort((a, b) => b.median - a.median).slice(0, 8);
}

function sum<T>(items: T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of items) s += f(x);
  return s;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number): number {
  return Math.round(n);
}
