import "server-only";
import { accountTail } from "@/lib/account-tail";

import { getDb } from "../index";
import type {
  HomeBankHealthItem,
  HomeCashFlow,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeNeedsAttention,
  HomeRecentTransaction,
} from "@/lib/types";
import { BANK_PROVIDERS } from "@/lib/types";
import { countedSql, notCountedSql } from "./counted";
import { scopeSql } from "../../lib/scope";
import { countReviewQueue } from "./transactions";
import { periodContaining, periodRange, shiftPeriod } from "@/lib/period";

export function getCashFlow(
  workspaceId: number,
  from: string,
  to: string
): HomeCashFlow {
  const db = getDb();
  const income = db
    .prepare(
      `SELECT COALESCE(SUM(charged_amount), 0) as total
       FROM spend_rows
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed' AND kind = 'income' AND ${countedSql()}`
    )
    .get(workspaceId, from, to) as { total: number };
  const expenses = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total
       FROM spend_rows
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed' AND kind = 'expense' AND ${countedSql()}`
    )
    .get(workspaceId, from, to) as { total: number };
  // Money that left an account but isn't spending: card bill payments,
  // transfers between your own accounts, and anything you chose not to count.
  const notCounted = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed' AND charged_amount < 0
         AND (kind = 'transfer' OR ${notCountedSql()}) AND ${scopeSql()}`
    )
    .get(workspaceId, from, to) as { total: number; count: number };
  return {
    income: income.total,
    expenses: expenses.total,
    net: income.total - expenses.total,
    notCounted: notCounted.total,
    notCountedCount: notCounted.count,
  };
}

export function getHistoricalTrend(
  workspaceId: number,
  monthsBack: number,
  /** 1 for calendar months; the payday when budgets run payday to payday. */
  startDay = 1
): HomeHistoricalTrendPoint[] {
  const db = getDb();
  const current = periodContaining(new Date(), startDay);
  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthKey = keyOf(current.start);

  // Each point is a budget period, named after the month it starts in.
  const months: { key: string; label: string; from: string; to: string }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const period = shiftPeriod(current, -i, startDay);
    const { from, to } = periodRange(period);
    months.push({
      key: keyOf(period.start),
      label: period.start.toLocaleDateString("en-US", { month: "short" }),
      from,
      to,
    });
  }

  const stmt = db.prepare(
    // Money out only, like every other spending total: a refund (a positive
    // row) must not add to what was spent.
    `SELECT COALESCE(SUM(CASE WHEN charged_amount < 0 THEN -charged_amount ELSE 0 END), 0) as total
     FROM spend_rows
     WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
       AND status = 'completed' AND kind = 'expense' AND ${countedSql()}`
  );

  return months.map((m) => {
    const row = stmt.get(workspaceId, m.from, m.to) as { total: number };
    return {
      month: m.key,
      label: m.label,
      total: row.total,
      isCurrent: m.key === currentMonthKey,
      from: m.from,
      to: m.to,
    };
  });
}

export function getRecentTransactionsForHome(
  workspaceId: number,
  limit: number
): HomeRecentTransaction[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.date, t.description, t.display_name as displayName, t.charged_amount as chargedAmount,
              t.charged_currency as chargedCurrency, t.kind,
              c.name as categoryName, c.color as categoryColor, c.icon as categoryIcon,
              t.provider, t.account_number as accountNumber,
              CASE WHEN ${countedSql("t")} THEN 1 ELSE 0 END as counted
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.workspace_id = ? AND t.status = 'completed' AND t.kind != 'transfer'
         AND t.is_excluded = 0 AND ${scopeSql("t")}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as Array<{
    id: number;
    date: string;
    description: string;
    displayName: string | null;
    chargedAmount: number;
    chargedCurrency: string | null;
    kind: "expense" | "income" | "transfer";
    categoryName: string | null;
    categoryColor: string | null;
    categoryIcon: string | null;
    provider: string;
    accountNumber: string | null;
    counted: number;
  }>;
  return rows.map(({ accountNumber, counted, ...row }) => {
    const tail = accountTail(accountNumber);
    return {
      ...row,
      providerName:
        BANK_PROVIDERS.find((p) => p.id === row.provider)?.name ?? row.provider,
      accountLast4:
        tail && (tail.digits.length >= 4 || tail.currency)
          ? tail.currency
            ? `${tail.digits} ${tail.currency}`
            : tail.digits
          : null,
      isCounted: counted === 1,
    };
  });
}

export function getNeedsAttentionCounts(
  workspaceId: number
): HomeNeedsAttention {
  const db = getDb();
  const uncategorized = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE workspace_id = ? AND category_id IS NULL AND kind = 'expense' AND status = 'completed'
         AND is_excluded = 0`
    )
    .get(workspaceId) as { count: number };
  const lowConfidence = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE workspace_id = ? AND ai_confidence IS NOT NULL AND ai_confidence < 0.5
         AND category_source = 'ai' AND status = 'completed' AND is_excluded = 0`
    )
    .get(workspaceId) as { count: number };
  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE workspace_id = ? AND status = 'completed' AND is_excluded = 0
         AND (
           (category_id IS NULL AND kind = 'expense')
           OR (ai_confidence IS NOT NULL AND ai_confidence < 0.5 AND category_source = 'ai')
           OR needs_review = 1
         )`
    )
    .get(workspaceId) as { count: number };
  return {
    uncategorized: uncategorized.count,
    lowConfidence: lowConfidence.count,
    flagged: countReviewQueue(workspaceId),
    total: total.count,
  };
}

export function getBankHealth(workspaceId: number): HomeBankHealthItem[] {
  const db = getDb();
  const creds = db
    .prepare(
      `SELECT provider FROM bank_credentials WHERE workspace_id = ? ORDER BY provider`
    )
    .all(workspaceId) as { provider: string }[];

  const latestRunStmt = db.prepare(
    `SELECT status, completed_at, error_message FROM sync_runs
     WHERE workspace_id = ? AND provider = ?
     ORDER BY started_at DESC LIMIT 1`
  );
  // A paused bank's old failures say nothing about it now; only imports count.
  const latestGoodRunStmt = db.prepare(
    `SELECT status, completed_at, error_message FROM sync_runs
     WHERE workspace_id = ? AND provider = ? AND status != 'failed'
     ORDER BY started_at DESC LIMIT 1`
  );
  const lastSuccessStmt = db.prepare(
    `SELECT MAX(completed_at) as at FROM sync_runs
     WHERE workspace_id = ? AND provider = ? AND status != 'failed'
       AND completed_at IS NOT NULL`
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) as count FROM transactions WHERE workspace_id = ? AND provider = ?`
  );

  const staleThresholdMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return creds.map(({ provider }): HomeBankHealthItem => {
    const paused = Boolean(BANK_PROVIDERS.find((p) => p.id === provider)?.syncPaused);
    const latest = (paused ? latestGoodRunStmt : latestRunStmt).get(workspaceId, provider) as
      | { status: string; completed_at: string | null; error_message: string | null }
      | undefined;
    const lastSuccessAt =
      (lastSuccessStmt.get(workspaceId, provider) as { at: string | null }).at;
    const transactionCount = (
      countStmt.get(workspaceId, provider) as { count: number }
    ).count;
    const providerInfo = BANK_PROVIDERS.find((p) => p.id === provider);
    const base = {
      provider,
      providerName: providerInfo?.name ?? provider,
      lastSuccessAt,
      transactionCount,
    };

    if (!latest || (latest.status !== "failed" && !latest.completed_at)) {
      return { ...base, lastSyncAt: null, status: "never", errorMessage: null };
    }

    if (latest.status === "failed") {
      return {
        ...base,
        lastSyncAt: latest.completed_at,
        status: "error",
        errorMessage: latest.error_message,
      };
    }

    const completedAt = latest.completed_at as string;
    const ageMs = now - new Date(completedAt + "Z").getTime();
    return {
      ...base,
      lastSyncAt: completedAt,
      status: ageMs > staleThresholdMs ? "stale" : "ok",
      errorMessage: null,
    };
  });
}

export function getCategorySnapshot(
  workspaceId: number,
  from: string,
  to: string,
  limit: number
): HomeCategorySnapshotItem[] {
  const db = getDb();

  const categories = db
    .prepare(
      `SELECT id, parent_id as parentId, name, color, icon
       FROM categories WHERE workspace_id = ? AND kind = 'expense'`
    )
    .all(workspaceId) as Array<{
    id: number;
    parentId: number | null;
    name: string;
    color: string;
    icon: string | null;
  }>;

  const parentIds = new Set<number>();
  for (const c of categories) {
    if (c.parentId != null) parentIds.add(c.parentId);
  }

  const spendRows = db
    .prepare(
      `SELECT category_id as categoryId, description as merchant,
              SUM(ABS(charged_amount)) as amount, COUNT(*) as count
       FROM spend_rows
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed' AND kind = 'expense'
         AND category_id IS NOT NULL AND ${countedSql()}
       GROUP BY category_id, description`
    )
    .all(workspaceId, from, to) as Array<{
    categoryId: number;
    merchant: string;
    amount: number;
    count: number;
  }>;

  const budgetRows = db
    .prepare(
      `SELECT category_id as categoryId, monthly_amount as monthlyAmount
       FROM budgets WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<{ categoryId: number; monthlyAmount: number }>;

  const budgetByCategory = new Map<number, number>();
  for (const b of budgetRows) budgetByCategory.set(b.categoryId, b.monthlyAmount);

  // Roll each leaf's spend up to its parent if it has one, else under its own id.
  const rolledSpend = new Map<number, number>();
  const rolledCount = new Map<number, number>();
  const rolledMerchants = new Map<number, Map<string, number>>();
  const rolledBudget = new Map<number, number>();

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  for (const row of spendRows) {
    const cat = categoryById.get(row.categoryId);
    if (!cat) continue;
    const key = cat.parentId ?? cat.id;
    rolledSpend.set(key, (rolledSpend.get(key) ?? 0) + row.amount);
    rolledCount.set(key, (rolledCount.get(key) ?? 0) + row.count);
    const merchants = rolledMerchants.get(key) ?? new Map<string, number>();
    merchants.set(row.merchant, (merchants.get(row.merchant) ?? 0) + row.amount);
    rolledMerchants.set(key, merchants);
  }

  // Roll up budgets the same way. Parent's explicit budget takes precedence
  // over the sum of children when it exists.
  for (const cat of categories) {
    const explicit = budgetByCategory.get(cat.id);
    if (explicit == null) continue;
    const key = cat.parentId ?? cat.id;
    if (cat.parentId == null && parentIds.has(cat.id)) {
      // A parent with its own explicit budget uses it directly.
      rolledBudget.set(key, explicit);
    } else {
      // Leaf budget: only add if parent doesn't have its own explicit budget.
      const parentHasOwnBudget =
        cat.parentId != null && budgetByCategory.has(cat.parentId);
      if (parentHasOwnBudget) continue;
      rolledBudget.set(key, (rolledBudget.get(key) ?? 0) + explicit);
    }
  }

  const items: HomeCategorySnapshotItem[] = [];
  for (const [key, spent] of rolledSpend) {
    const cat = categoryById.get(key);
    if (!cat) continue;
    const budget = rolledBudget.get(key) ?? 0;
    let topMerchant: string | null = null;
    let topAmount = 0;
    for (const [merchant, amount] of rolledMerchants.get(key) ?? []) {
      if (amount > topAmount) {
        topMerchant = merchant;
        topAmount = amount;
      }
    }
    items.push({
      categoryId: key,
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
      spent,
      budget,
      percentSpent: budget > 0 ? (spent / budget) * 100 : 0,
      count: rolledCount.get(key) ?? 0,
      topMerchant,
    });
  }

  items.sort((a, b) => b.spent - a.spent);
  return items.slice(0, limit);
}
