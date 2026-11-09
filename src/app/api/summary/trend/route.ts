import { NextResponse } from "next/server";
import {
  getCategorySpendInRange,
  getIncomeTotal,
  getPeriodTotal,
} from "@/server/db/queries/transactions";
import { getAllCategories } from "@/server/db/queries/categories";
import { getAllBudgets } from "@/server/db/queries/budgets";
import { getPeriodStartDay, getWorkspaceSetting } from "@/server/db/queries/settings";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";
import { parseISODay, periodContaining, periodRange, shiftPeriod } from "@/lib/period";
import type { SpendingTrend, TrendCategory, TrendPeriod } from "@/lib/types";

/** Three years of months; longer spans stop being readable as bars. */
const MAX_PERIODS = 36;

/**
 * Spending per budget period across a span (the Budgets page's multi-month
 * view). `from` and `to` are any days inside the first and last period; each
 * period is a calendar month or payday to payday, like the month view.
 */
async function handleGET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const startDay = getPeriodStartDay(workspaceId);
  const today = new Date();
  const current = periodContaining(today, startDay);

  const toDay = parseISODay(searchParams.get("to") ?? "") ?? today;
  const fromDay =
    parseISODay(searchParams.get("from") ?? "") ?? shiftPeriod(current, -11, startDay).start;
  // Nothing to show after the running period.
  let last = periodContaining(toDay, startDay);
  if (last.start > current.start) last = current;
  let first = periodContaining(fromDay, startDay);
  if (first.start > last.start) first = last;

  const periods: { from: string; to: string; inProgress: boolean }[] = [];
  for (let p = first; p.start <= last.start && periods.length < MAX_PERIODS; p = shiftPeriod(p, 1, startDay)) {
    periods.push({ ...periodRange(p), inProgress: p.start.getTime() === current.start.getTime() });
  }

  const categories = getAllCategories(workspaceId, "expense");
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentIds = new Set(categories.filter((c) => c.parentId != null).map((c) => c.parentId!));
  // A child's spending counts toward its parent, as on the month view's charts.
  const topLevelId = (id: number) => {
    const parentId = byId.get(id)?.parentId;
    return parentId != null && parentIds.has(parentId) ? parentId : id;
  };

  const totals = new Map<number, number>();
  const result: TrendPeriod[] = periods.map((p) => {
    const byCategory: Record<string, number> = {};
    let categorized = 0;
    for (const row of getCategorySpendInRange(workspaceId, p.from, p.to)) {
      const id = topLevelId(row.categoryId);
      byCategory[id] = (byCategory[id] ?? 0) + row.amount;
      totals.set(id, (totals.get(id) ?? 0) + row.amount);
      categorized += row.amount;
    }
    const spent = getPeriodTotal(workspaceId, p.from, p.to);
    return {
      ...p,
      spent,
      income: getIncomeTotal(workspaceId, p.from, p.to),
      byCategory,
      // Rounded, so floating-point leftovers don't read as uncategorized spending.
      uncategorized: Math.max(0, Math.round((spent - categorized) * 100) / 100),
    };
  });

  // Same budget rules as the month view: a parent uses its own budget when it
  // has one, else the sum of its budgeted children. Tracking-only is 0.
  const budgets = new Map(getAllBudgets(workspaceId).map((b) => [b.categoryId, b.monthlyAmount]));
  const budgetOf = (id: number): number => {
    const cat = byId.get(id);
    if (!cat) return 0;
    if (parentIds.has(id)) {
      const own = budgets.get(id);
      if (cat.budgetMode === "budgeted" && own !== undefined) return own;
      return categories
        .filter((c) => c.parentId === id && c.budgetMode === "budgeted")
        .reduce((s, c) => s + (budgets.get(c.id) ?? 0), 0);
    }
    return cat.budgetMode === "budgeted" ? (budgets.get(id) ?? 0) : 0;
  };

  const trendCategories: TrendCategory[] = [...totals.entries()]
    .filter(([, total]) => total > 0)
    .map(([id, total]) => {
      const cat = byId.get(id);
      return {
        categoryId: id,
        name: cat?.name ?? "",
        color: cat?.color ?? "#888888",
        total,
        monthlyBudget: budgetOf(id),
      };
    })
    .sort((a, b) => b.total - a.total);

  const targetRaw = Number(getWorkspaceSetting(workspaceId, "monthly_target") ?? NaN);

  const body: SpendingTrend = {
    periods: result,
    categories: trendCategories,
    monthlyTarget: Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : 0,
  };
  return NextResponse.json(body);
}

/** Totals follow the budget scope (bank bundles) the client picked, like /api/summary. */
export async function GET(...args: Parameters<typeof handleGET>) {
  const [request] = args;
  return withRequestScope(request, getWorkspaceIdFromRequest(request), () => handleGET(...args));
}
