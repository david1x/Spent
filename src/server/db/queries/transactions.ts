import "server-only";

import { getDb } from "../index";
import { computeDedupHash } from "../../lib/dedup";
import { detectKind } from "../../lib/transfers";
import { countedSql, notCountedSql } from "./counted";
import { scopeSql } from "../../lib/scope";
import { getCardRouteMap } from "../../lib/card-routes";
import { normalizeCurrency } from "@/lib/currency";
import { estimateIlsCharge, needsIlsEstimate } from "../../lib/fx-estimate";
import type {
  TransactionWithCategory,
  MonthlySummary,
  MerchantSummary,
  CategoryBreakdown,
  TransactionListAggregates,
  InstallmentPlan,
  TransactionHistory,
} from "@/lib/types";
import {
  isTransactionSortField,
  TRANSACTION_SORT_SQL,
} from "@/lib/transaction-sort";
/**
 * "expense" / "income" split by sign only. "spending" / "counted_income" are
 * the counted rows of each sign, and "not_counted" is the rest, so the three
 * partition the list the same way the Transactions page totals do.
 */
export type TransactionKindFilter =
  | "expense"
  | "income"
  | "all"
  | "spending"
  | "counted_income"
  | "not_counted";

/** Row counts toward spending/income totals (alias `t`). */
function countedRowSql(): string {
  return `(t.kind != 'transfer' AND ${countedSql("t")})`;
}

function kindFilterSql(kind: TransactionKindFilter): string | null {
  switch (kind) {
    case "income":
      return "t.charged_amount > 0";
    case "expense":
      return "t.charged_amount < 0";
    case "spending":
      return `${countedRowSql()} AND t.charged_amount < 0`;
    case "counted_income":
      return `${countedRowSql()} AND t.charged_amount > 0`;
    case "not_counted":
      return `NOT ${countedRowSql()}`;
    default:
      return null;
  }
}

interface RawTransaction {
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier?: string | number;
  installmentNumber?: number;
  installmentTotal?: number;
}

interface InsertResult {
  added: number;
  updated: number;
  /** Other workspaces that received rows because a card is routed there. */
  routedWorkspaceIds: number[];
}

export function insertTransactions(
  workspaceId: number,
  transactions: RawTransaction[],
  provider: string,
  credentialId: number,
  syncRunId: number
): InsertResult {
  const db = getDb();
  let added = 0;
  let updated = 0;

  // Hashes are counted per workspace, since a routed card's rows dedup
  // against the workspace they land in.
  const hashCounts = new Map<string, number>();
  const routes = getCardRouteMap(credentialId);
  const routedWorkspaceIds = new Set<number>();

  const existingCountStmt = db.prepare(
    "SELECT COUNT(*) as count FROM transactions WHERE workspace_id = ? AND dedup_hash = ?"
  );

  const insertStmt = db.prepare(`
    INSERT INTO transactions (
      workspace_id, account_number, date, processed_date, original_amount, original_currency,
      charged_amount, charged_currency, description, memo, type, status,
      identifier, installment_number, installment_total, provider, credential_id,
      sync_run_id, dedup_hash, dedup_sequence, kind, charged_estimated
    ) VALUES (
      @workspaceId, @accountNumber, @date, @processedDate, @originalAmount, @originalCurrency,
      @chargedAmount, @chargedCurrency, @description, @memo, @type, @status,
      @identifier, @installmentNumber, @installmentTotal, @provider, @credentialId,
      @syncRunId, @dedupHash, @dedupSequence, @kind, @chargedEstimated
    )
    ON CONFLICT(workspace_id, dedup_hash, dedup_sequence) DO UPDATE SET
      status = CASE WHEN transactions.status = 'pending' THEN excluded.status ELSE transactions.status END,
      -- A real shekel amount replaces an estimate (migration 025).
      charged_amount = CASE WHEN transactions.status = 'pending'
                              OR (transactions.charged_estimated = 1 AND excluded.charged_estimated = 0)
                            THEN excluded.charged_amount ELSE transactions.charged_amount END,
      charged_estimated = CASE WHEN transactions.status = 'pending' OR transactions.charged_estimated = 1
                               THEN excluded.charged_estimated ELSE transactions.charged_estimated END,
      processed_date = CASE WHEN transactions.status = 'pending' THEN excluded.processed_date ELSE transactions.processed_date END,
      kind = transactions.kind,
      updated_at = CASE WHEN transactions.status = 'pending' THEN datetime('now') ELSE transactions.updated_at END
  `);

  const batchInsert = db.transaction(() => {
    for (const txn of transactions) {
      const hash = computeDedupHash({
        accountNumber: txn.accountNumber,
        date: txn.date,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency,
        description: txn.description,
        identifier: txn.identifier,
        installmentNumber: txn.installmentNumber,
        installmentTotal: txn.installmentTotal,
      });

      const targetWorkspaceId = routes.get(txn.accountNumber) ?? workspaceId;
      if (targetWorkspaceId !== workspaceId) routedWorkspaceIds.add(targetWorkspaceId);

      const countKey = `${targetWorkspaceId}:${hash}`;
      const batchCount = (hashCounts.get(countKey) ?? 0) + 1;
      hashCounts.set(countKey, batchCount);

      const { count: existingCount } = existingCountStmt.get(targetWorkspaceId, hash) as {
        count: number;
      };

      const sequence = batchCount - 1;
      const kind = detectKind(txn.description, provider, txn.chargedAmount);
      const estimate = needsIlsEstimate(txn.originalCurrency, txn.originalAmount, txn.chargedAmount)
        ? estimateIlsCharge(db, txn.originalCurrency, txn.originalAmount, txn.date)
        : null;

      const params = {
        workspaceId: targetWorkspaceId,
        accountNumber: txn.accountNumber,
        date: txn.date,
        processedDate: txn.processedDate,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency,
        chargedAmount: estimate ?? txn.chargedAmount,
        chargedCurrency: estimate !== null ? "ILS" : (txn.chargedCurrency ?? null),
        chargedEstimated: estimate !== null ? 1 : 0,
        description: txn.description,
        memo: txn.memo ?? null,
        type: txn.type,
        status: txn.status,
        identifier: txn.identifier != null ? String(txn.identifier) : null,
        installmentNumber: txn.installmentNumber ?? null,
        installmentTotal: txn.installmentTotal ?? null,
        provider,
        credentialId,
        syncRunId: syncRunId,
        dedupHash: hash,
        dedupSequence: sequence,
        kind,
      };

      if (batchCount > existingCount) {
        insertStmt.run(params);
        added++;
      } else {
        const result = insertStmt.run(params);
        if (result.changes > 0) {
          updated++;
        }
      }
    }
  });

  batchInsert();
  return { added, updated, routedWorkspaceIds: [...routedWorkspaceIds] };
}

interface QueryParams {
  from?: string;
  to?: string;
  search?: string;
  category?: number;
  /**
   * Multi-id filter for parent-category aggregation. Takes precedence over
   * `category` when present and non-empty. Use it to fetch transactions
   * across all children of a parent category.
   */
  categoryIds?: number[];
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  kind?: TransactionKindFilter;
  provider?: string;
  /** @deprecated Use credentialIds */
  credentialId?: number;
  credentialIds?: number[];
  /** Account keys: "12" for a whole login, "12:4321" for one card under it. */
  accounts?: string[];
  /** Also return per-segment counts, totals and per-day totals. */
  withAggregates?: boolean;
  /** Only the review queue (same rows countReviewQueue counts), any date. */
  reviewOnly?: boolean;
}

/**
 * Account filter keys from the Transactions page: "12" is a whole login,
 * "12:4321" is one account (usually one card) under that login.
 */
function appendAccountKeysFilter(
  conditions: string[],
  values: (string | number)[],
  keys: string[] | undefined,
  columnPrefix = ""
): void {
  if (!keys || keys.length === 0) return;
  const parts: string[] = [];
  for (const key of keys) {
    const [idPart, ...rest] = key.split(":");
    const id = Number(idPart);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (rest.length === 0) {
      parts.push(`${columnPrefix}credential_id = ?`);
      values.push(id);
    } else {
      parts.push(`(${columnPrefix}credential_id = ? AND ${columnPrefix}account_number = ?)`);
      values.push(id, rest.join(":"));
    }
  }
  if (parts.length > 0) conditions.push(`(${parts.join(" OR ")})`);
}

function appendCredentialIdsFilter(
  conditions: string[],
  values: (string | number)[],
  credentialIds: number[] | undefined,
  columnPrefix = ""
): void {
  if (!credentialIds || credentialIds.length === 0) return;
  const col = `${columnPrefix}credential_id`;
  const placeholders = credentialIds.map(() => "?").join(",");
  conditions.push(`${col} IN (${placeholders})`);
  for (const id of credentialIds) values.push(id);
}

function resolveSortSql(sort: string | undefined): string {
  if (isTransactionSortField(sort)) {
    return TRANSACTION_SORT_SQL[sort];
  }
  return TRANSACTION_SORT_SQL.date;
}

const TRANSACTION_LIST_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN bank_credentials bc ON t.credential_id = bc.id`;

const TRANSACTION_LIST_SELECT = `
  SELECT t.*, c.name AS category_name, c.color AS category_color,
         bc.label AS account_label,
         (SELECT cb.label FROM bank_credentials cb WHERE cb.id = t.card_bill_credential_id) AS card_bill_label,
         CASE WHEN ${countedRowSql()} THEN 1 ELSE 0 END AS is_counted
  ${TRANSACTION_LIST_FROM}`;

export function queryTransactions(
  workspaceId: number,
  params: QueryParams
): {
  transactions: TransactionWithCategory[];
  total: number;
  aggregates?: TransactionListAggregates;
} {
  const db = getDb();
  const conditions: string[] = ["t.workspace_id = ?"];
  const values: (string | number)[] = [workspaceId];

  if (params.from) {
    conditions.push("date(t.date, 'localtime') >= ?");
    values.push(params.from);
  }
  if (params.to) {
    conditions.push("date(t.date, 'localtime') <= ?");
    values.push(params.to);
  }
  if (params.search) {
    conditions.push("(t.description LIKE ? OR t.memo LIKE ?)");
    const term = `%${params.search}%`;
    values.push(term, term);
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    const placeholders = params.categoryIds.map(() => "?").join(",");
    conditions.push(`t.category_id IN (${placeholders})`);
    for (const cid of params.categoryIds) values.push(cid);
  } else if (params.category !== undefined) {
    conditions.push("t.category_id = ?");
    values.push(params.category);
  }
  if (params.provider) {
    conditions.push("t.provider = ?");
    values.push(params.provider);
  }
  const credentialIds =
    params.credentialIds && params.credentialIds.length > 0
      ? params.credentialIds
      : params.credentialId != null
        ? [params.credentialId]
        : undefined;
  appendCredentialIdsFilter(conditions, values, credentialIds, "t.");
  appendAccountKeysFilter(conditions, values, params.accounts, "t.");
  if (params.reviewOnly) {
    conditions.push("t.needs_review = 1 AND t.status = 'completed' AND t.is_excluded = 0");
  }
  // The budget scope (bank bundles) narrows the list like every total.
  conditions.push(scopeSql("t"));

  // Segment counts ignore the type filter, so capture the WHERE before it.
  const baseWhere = `WHERE ${conditions.join(" AND ")}`;
  const kindSql = kindFilterSql(params.kind ?? "all");
  if (kindSql) conditions.push(kindSql);

  const where = `WHERE ${conditions.join(" AND ")}`;

  const sortSql = resolveSortSql(params.sort);
  const sortOrder = params.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM transactions t ${where}`)
    .get(...values) as { total: number };

  const rows = db
    .prepare(
      `${TRANSACTION_LIST_SELECT}
       ${where}
       ORDER BY ${sortSql} ${sortOrder}, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset);

  return {
    transactions: rows.map(mapTransactionRow),
    total: countRow.total,
    aggregates: params.withAggregates
      ? queryListAggregates(baseWhere, where, values)
      : undefined,
  };
}

function queryListAggregates(
  baseWhere: string,
  where: string,
  values: (string | number)[]
): TransactionListAggregates {
  const db = getDb();
  const counted = countedRowSql();
  // Totals follow Home (completed rows only); counts include pending rows
  // because they are listed too.
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS allCount,
              COALESCE(SUM(CASE WHEN ${counted} AND t.charged_amount < 0 THEN 1 ELSE 0 END), 0) AS spendingCount,
              COALESCE(SUM(CASE WHEN ${counted} AND t.charged_amount > 0 THEN 1 ELSE 0 END), 0) AS incomeCount,
              COALESCE(SUM(CASE WHEN NOT ${counted} THEN 1 ELSE 0 END), 0) AS notCountedCount,
              COALESCE(SUM(CASE WHEN t.status = 'completed' AND ${counted} AND t.charged_amount < 0 THEN -t.charged_amount ELSE 0 END), 0) AS spent,
              COALESCE(SUM(CASE WHEN t.status = 'completed' AND ${counted} AND t.charged_amount > 0 THEN t.charged_amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.status = 'completed' AND NOT ${counted} AND t.charged_amount < 0 THEN -t.charged_amount ELSE 0 END), 0) AS notCounted
       FROM transactions t
       ${baseWhere}`
    )
    .get(...values) as {
    allCount: number;
    spendingCount: number;
    incomeCount: number;
    notCountedCount: number;
    spent: number;
    income: number;
    notCounted: number;
  };

  // Day headers sum the rows shown under them, pending included.
  const days = db
    .prepare(
      `SELECT t.date AS date,
              COALESCE(SUM(CASE WHEN ${counted} AND t.charged_amount < 0 THEN -t.charged_amount ELSE 0 END), 0) AS spent,
              COALESCE(SUM(CASE WHEN ${counted} AND t.charged_amount > 0 THEN t.charged_amount ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN NOT ${counted} AND t.charged_amount < 0 THEN -t.charged_amount ELSE 0 END), 0) AS notCounted
       FROM transactions t
       ${where}
       GROUP BY t.date`
    )
    .all(...values) as TransactionListAggregates["days"];

  return {
    counts: {
      all: totals.allCount,
      spending: totals.spendingCount,
      income: totals.incomeCount,
      notCounted: totals.notCountedCount,
    },
    spent: totals.spent,
    income: totals.income,
    notCounted: totals.notCounted,
    days,
  };
}

export function getUncategorizedTransactionIds(workspaceId: number): number[] {
  const rows = getDb()
    .prepare(
      "SELECT id FROM transactions WHERE workspace_id = ? AND category_id IS NULL AND kind != 'transfer' AND is_excluded = 0 ORDER BY date DESC"
    )
    .all(workspaceId) as { id: number }[];
  return rows.map((r) => r.id);
}

export function getUncategorizedIdsByKind(
  workspaceId: number,
  kind: "expense" | "income"
): number[] {
  const rows = getDb()
    .prepare(
      "SELECT id FROM transactions WHERE workspace_id = ? AND category_id IS NULL AND kind = ? AND is_excluded = 0 ORDER BY date DESC"
    )
    .all(workspaceId, kind) as { id: number }[];
  return rows.map((r) => r.id);
}

export function getTransactionsForCategorization(
  workspaceId: number,
  ids: number[]
): { id: number; description: string; chargedAmount: number; originalCurrency: string; memo: string | null }[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT id, description, charged_amount as chargedAmount,
              original_currency as originalCurrency, memo
       FROM transactions WHERE workspace_id = ? AND id IN (${placeholders})`
    )
    .all(workspaceId, ...ids) as { id: number; description: string; chargedAmount: number; originalCurrency: string; memo: string | null }[];
}

export function updateTransactionCategory(
  workspaceId: number,
  id: number,
  categoryId: number,
  source: "ai" | "user"
): void {
  getDb()
    .prepare(
      `UPDATE transactions
       SET category_id = ?, category_source = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    )
    .run(categoryId, source, workspaceId, id);
}

export function batchUpdateCategories(
  workspaceId: number,
  updates: { id: number; categoryId: number; aiConfidence?: number | null }[]
): void {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE transactions
     SET category_id = ?, category_source = 'ai', ai_confidence = ?, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ? AND category_source IS NOT 'user'`
  );

  db.transaction(() => {
    for (const { id, categoryId, aiConfidence } of updates) {
      stmt.run(categoryId, aiConfidence ?? null, workspaceId, id);
    }
  })();
}


export function getMonthlySummary(
  workspaceId: number,
  months: number
): MonthlySummary[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', date) as month,
              SUM(ABS(charged_amount)) as amount
       FROM transactions
       WHERE workspace_id = ?
         AND date >= date('now', '-' || ? || ' months')
         AND status = 'completed'
         AND kind = 'expense'
         AND ${countedSql()}
       GROUP BY month
       ORDER BY month ASC`
    )
    .all(workspaceId, months) as MonthlySummary[];
}

export function getTopMerchants(
  workspaceId: number,
  from: string,
  to: string,
  limit = 10
): MerchantSummary[] {
  return getDb()
    .prepare(
      `SELECT description as name,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ? AND status = 'completed' AND kind = 'expense'
         AND ${countedSql()}
       GROUP BY description
       ORDER BY amount DESC
       LIMIT ?`
    )
    .all(workspaceId, from, to, limit) as MerchantSummary[];
}

export function getCategoryBreakdown(
  workspaceId: number,
  from: string,
  to: string
): CategoryBreakdown[] {
  return getDb()
    .prepare(
      `SELECT
         COALESCE(t.category_id, 0) as categoryId,
         COALESCE(c.name, 'Uncategorized') as name,
         COALESCE(c.color, '#B5B3AC') as color,
         SUM(ABS(t.charged_amount)) as amount,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.workspace_id = ? AND date(t.date, 'localtime') >= ? AND date(t.date, 'localtime') <= ? AND t.status = 'completed' AND t.kind = 'expense'
         AND ${countedSql("t")}
       GROUP BY t.category_id
       ORDER BY amount DESC`
    )
    .all(workspaceId, from, to) as CategoryBreakdown[];
}

export interface CategorySpend {
  categoryId: number;
  amount: number;
  count: number;
}

export function getCategorySpendInRange(
  workspaceId: number,
  from: string,
  to: string
): CategorySpend[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ? AND status = 'completed' AND kind = 'expense' AND category_id IS NOT NULL
         AND ${countedSql()}
       GROUP BY category_id`
    )
    .all(workspaceId, from, to) as CategorySpend[];
}

export interface CategoryTopMerchant {
  categoryId: number;
  merchant: string;
  amount: number;
}

export function getTopMerchantPerCategory(
  workspaceId: number,
  from: string,
  to: string
): CategoryTopMerchant[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId, description as merchant, amount
       FROM (
         SELECT category_id, description, SUM(ABS(charged_amount)) as amount,
                ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY SUM(ABS(charged_amount)) DESC) as rn
         FROM transactions
         WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ? AND status = 'completed' AND kind = 'expense' AND category_id IS NOT NULL
           AND ${countedSql()}
         GROUP BY category_id, description
       )
       WHERE rn = 1`
    )
    .all(workspaceId, from, to) as CategoryTopMerchant[];
}

export interface DailySpendPoint {
  date: string;
  amount: number;
}

export function getCategorySpendByDay(
  workspaceId: number,
  categoryId: number,
  from: string,
  to: string
): DailySpendPoint[] {
  return getDb()
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date(?)
         UNION ALL
         SELECT date(d, '+1 day') FROM days WHERE d < date(?)
       )
       SELECT days.d as date,
              COALESCE(SUM(ABS(t.charged_amount)), 0) as amount
       FROM days
       LEFT JOIN transactions t
         ON date(t.date, 'localtime') = days.d
         AND t.workspace_id = ?
         AND t.category_id = ?
         AND t.kind = 'expense'
         AND t.status = 'completed'
         AND t.is_excluded = 0
         AND ${scopeSql("t")}
       GROUP BY days.d
       ORDER BY days.d ASC`
    )
    .all(from, to, workspaceId, categoryId) as DailySpendPoint[];
}

export interface TopMerchantForCategory {
  merchant: string;
  amount: number;
  count: number;
}

export function getTopMerchantsForCategory(
  workspaceId: number,
  categoryId: number,
  from: string,
  to: string,
  limit = 8
): TopMerchantForCategory[] {
  return getDb()
    .prepare(
      `SELECT description as merchant,
              SUM(ABS(charged_amount)) as amount,
              COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND category_id = ?
         AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed'
         AND kind = 'expense'
         AND is_excluded = 0
         AND ${scopeSql()}
       GROUP BY description
       ORDER BY amount DESC
       LIMIT ?`
    )
    .all(workspaceId, categoryId, from, to, limit) as TopMerchantForCategory[];
}

export function getPeriodTotal(
  workspaceId: number,
  from: string,
  to: string
): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ? AND status = 'completed' AND kind = 'expense'
         AND ${countedSql()}`
    )
    .get(workspaceId, from, to) as { total: number };
  return row.total;
}

export function getPeriodCount(
  workspaceId: number,
  from: string,
  to: string
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ? AND status = 'completed' AND kind = 'expense'
         AND ${countedSql()}`
    )
    .get(workspaceId, from, to) as { count: number };
  return row.count;
}

interface TransactionRow {
  id: number;
  account_number: string;
  date: string;
  processed_date: string;
  original_amount: number;
  original_currency: string;
  charged_amount: number;
  charged_currency: string | null;
  description: string;
  memo: string | null;
  type: string;
  status: string;
  identifier: string | null;
  installment_number: number | null;
  installment_total: number | null;
  category_id: number | null;
  category_source: string | null;
  ai_confidence: number | null;
  provider: string;
  credential_id: number | null;
  sync_run_id: number;
  kind: string;
  needs_review: number;
  is_excluded: number;
  charged_estimated?: number | null;
  created_at: string;
  updated_at: string;
  category_name?: string | null;
  category_color?: string | null;
  account_label?: string | null;
  card_bill_label?: string | null;
  card_bill_accounts?: string | null;
  is_counted?: number | null;
}

/** "CAL ••4321" for one card, just "CAL" when one debit paid several. */
function cardBillLabel(
  label: string | null | undefined,
  accounts: string | null | undefined
): string | null {
  if (!label) return null;
  const list = (accounts ?? "").split(",").filter(Boolean);
  return list.length === 1 ? `${label} ••${list[0].slice(-4)}` : label;
}

function mapTransactionRow(row: unknown): TransactionWithCategory {
  const r = row as TransactionRow;
  return {
    id: r.id,
    accountNumber: r.account_number,
    date: r.date,
    processedDate: r.processed_date,
    originalAmount: r.original_amount,
    originalCurrency: normalizeCurrency(r.original_currency),
    chargedAmount: r.charged_amount,
    chargedCurrency: r.charged_currency == null ? null : normalizeCurrency(r.charged_currency),
    description: r.description,
    memo: r.memo,
    type: r.type as "normal" | "installments",
    status: r.status as "completed" | "pending",
    identifier: r.identifier,
    installmentNumber: r.installment_number,
    installmentTotal: r.installment_total,
    categoryId: r.category_id,
    categorySource: r.category_source as "ai" | "user" | null,
    aiConfidence: r.ai_confidence,
    provider: r.provider,
    credentialId: r.credential_id ?? null,
    accountLabel: r.account_label ?? null,
    cardBillLabel: cardBillLabel(r.card_bill_label, r.card_bill_accounts),
    syncRunId: r.sync_run_id,
    kind: r.kind as "expense" | "income" | "transfer",
    needsReview: r.needs_review === 1,
    isExcluded: r.is_excluded === 1,
    chargedEstimated: r.charged_estimated === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categoryName: r.category_name ?? null,
    categoryColor: r.category_color ?? null,
    ...(r.is_counted != null ? { isCounted: r.is_counted === 1 } : {}),
  };
}

const HISTORY_ROW_LIMIT = 500;

/**
 * The payment history sheet: the installment plan this row belongs to (if
 * any) and every row with the same merchant name. Workspace-wide, so bank
 * bundles don't hide earlier payments made from another account.
 */
export function getTransactionHistory(
  workspaceId: number,
  id: number
): TransactionHistory | null {
  const db = getDb();
  const row = db
    .prepare(`${TRANSACTION_LIST_SELECT} WHERE t.workspace_id = ? AND t.id = ?`)
    .get(workspaceId, id);
  if (!row) return null;
  const transaction = mapTransactionRow(row);

  const merchantRows = db
    .prepare(
      `${TRANSACTION_LIST_SELECT}
       WHERE t.workspace_id = ? AND t.description = ?
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`
    )
    .all(workspaceId, transaction.description, HISTORY_ROW_LIMIT)
    .map(mapTransactionRow);
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE workspace_id = ? AND description = ?"
    )
    .get(workspaceId, transaction.description) as { count: number };

  return {
    transaction,
    plan: transaction.type === "installments" ? getInstallmentPlan(workspaceId, transaction) : null,
    merchant: { transactions: merchantRows, count },
  };
}

/**
 * Banks report each installment as its own row. The rows of one purchase share
 * the card, merchant name and full purchase amount; their dates move month to
 * month, so the date can't be part of the match.
 */
function getInstallmentPlan(
  workspaceId: number,
  txn: TransactionWithCategory
): InstallmentPlan | null {
  const payments = getDb()
    .prepare(
      `${TRANSACTION_LIST_SELECT}
       WHERE t.workspace_id = ?
         AND t.type = 'installments'
         AND t.credential_id IS ?
         AND t.account_number = ?
         AND t.description = ?
         AND t.original_amount = ?
         AND (t.installment_total IS ? OR ? IS NULL OR t.installment_total IS NULL)
       ORDER BY t.processed_date ASC, t.installment_number ASC, t.id ASC`
    )
    .all(
      workspaceId,
      txn.credentialId,
      txn.accountNumber,
      txn.description,
      txn.originalAmount,
      txn.installmentTotal,
      txn.installmentTotal
    )
    .map(mapTransactionRow);
  if (payments.length === 0) return null;

  const total = payments.reduce<number | null>(
    (max, p) => (p.installmentTotal && p.installmentTotal > (max ?? 0) ? p.installmentTotal : max),
    null
  );
  const numbered = payments.filter((p) => (p.installmentNumber ?? 0) > 0);
  const last = numbered.length > 0 ? numbered[numbered.length - 1] : payments[payments.length - 1];
  const paidCount = Math.max(
    payments.length,
    ...numbered.map((p) => p.installmentNumber as number)
  );
  const purchaseAmount = Math.abs(txn.originalAmount);
  const perPayment = Math.abs(last.chargedAmount);

  const upcoming: InstallmentPlan["upcoming"] = [];
  let remaining = 0;
  if (total !== null && paidCount < total && perPayment > 0) {
    const left = total - paidCount;
    // The first installment usually absorbs the rounding, so the rest of the
    // purchase is the better guess when it is in the right range.
    const byPurchase = purchaseAmount - perPayment * paidCount;
    remaining =
      byPurchase > perPayment * (left - 0.5) && byPurchase < perPayment * (left + 0.5)
        ? byPurchase
        : perPayment * left;
    const lastNumber = last.installmentNumber && last.installmentNumber > 0 ? last.installmentNumber : paidCount;
    for (let n = paidCount + 1; n <= total; n++) {
      // Charge dates, not purchase dates: banks move the purchase date a
      // month per installment, but the charge date is when money leaves.
      const date = new Date(last.processedDate);
      date.setMonth(date.getMonth() + (n - lastNumber));
      const amount = n === total ? remaining - perPayment * (left - 1) : perPayment;
      upcoming.push({ number: n, date: date.toISOString(), amount: Math.round(amount * 100) / 100 });
    }
  }

  return {
    total,
    purchaseAmount,
    currency: txn.originalCurrency,
    paidCount: total !== null ? Math.min(paidCount, total) : paidCount,
    payments,
    upcoming,
    remaining: Math.round(remaining * 100) / 100,
  };
}

export function setTransactionKind(
  workspaceId: number,
  id: number,
  kind: "expense" | "income" | "transfer"
): void {
  getDb()
    .prepare(
      `UPDATE transactions
       SET kind = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    )
    .run(kind, workspaceId, id);
}

export function setTransactionNeedsReview(
  workspaceId: number,
  id: number,
  value: boolean
): void {
  getDb()
    .prepare(
      `UPDATE transactions
       SET needs_review = ?, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    )
    .run(value ? 1 : 0, workspaceId, id);
}

interface TransactionContext {
  id: number;
  description: string;
  categoryId: number | null;
  categorySource: "ai" | "user" | null;
  kind: "expense" | "income" | "transfer";
  provider: string;
}

export function getTransactionContext(
  workspaceId: number,
  id: number
): TransactionContext | null {
  const row = getDb()
    .prepare(
      `SELECT id, description, category_id as categoryId,
              category_source as categorySource, kind, provider
       FROM transactions WHERE workspace_id = ? AND id = ?`
    )
    .get(workspaceId, id) as TransactionContext | undefined;
  return row ?? null;
}

export function batchSetNeedsReview(
  workspaceId: number,
  updates: { id: number; needsReview: boolean }[]
): void {
  if (updates.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE transactions
     SET needs_review = ?, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ?`
  );
  db.transaction(() => {
    for (const { id, needsReview } of updates) {
      stmt.run(needsReview ? 1 : 0, workspaceId, id);
    }
  })();
}

export interface NeedsReviewCount {
  categoryId: number;
  count: number;
}

export interface TransactionsSummary {
  income: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  expense: {
    total: number;
    count: number;
    largest: TransactionWithCategory | null;
  };
  net: number;
  /** Outflows left out of `expense`: card bills, own-account transfers, excluded rows. */
  notCounted: { total: number; count: number };
  topMerchants: { description: string; total: number; count: number }[];
  pendingReviewCount: number;
  /** Rows with no category at all: what AI categorization works on. */
  uncategorizedCount: number;
}

export interface TransactionsSummaryParams {
  /** @deprecated Use credentialIds */
  credentialId?: number;
  credentialIds?: number[];
  /** Account keys: "12" for a whole login, "12:4321" for one card under it. */
  accounts?: string[];
}

export function getTransactionsSummary(
  workspaceId: number,
  from: string,
  to: string,
  params: TransactionsSummaryParams = {}
): TransactionsSummary {
  const db = getDb();
  const baseConditions = [
    "workspace_id = ?",
    "date(date, 'localtime') >= ?",
    "date(date, 'localtime') <= ?",
    "status = 'completed'",
    // Card bill payments and not-counted rows would double count spending
    // already itemized on the card statement. Match Home's totals.
    "kind != 'transfer'",
    countedSql(),
  ];
  const baseValues: (string | number)[] = [workspaceId, from, to];
  const summaryCredentialIds =
    params.credentialIds && params.credentialIds.length > 0
      ? params.credentialIds
      : params.credentialId != null
        ? [params.credentialId]
        : undefined;
  appendCredentialIdsFilter(baseConditions, baseValues, summaryCredentialIds);
  appendAccountKeysFilter(baseConditions, baseValues, params.accounts);
  const baseWhere = baseConditions.join(" AND ");

  const incomeAgg = db
    .prepare(
      `SELECT COALESCE(SUM(charged_amount), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount > 0`
    )
    .get(...baseValues) as { total: number; count: number };

  const expenseAgg = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount < 0`
    )
    .get(...baseValues) as { total: number; count: number };

  const pickLargest = (sign: "income" | "expense"): TransactionWithCategory | null => {
    const cmp = sign === "income" ? "> 0" : "< 0";
    const tConditions = [
      "t.workspace_id = ?",
      "date(t.date, 'localtime') >= ?",
      "date(t.date, 'localtime') <= ?",
      "t.status = 'completed'",
      "t.kind != 'transfer'",
      countedSql("t"),
      `t.charged_amount ${cmp}`,
    ];
    const tValues: (string | number)[] = [workspaceId, from, to];
    appendCredentialIdsFilter(tConditions, tValues, summaryCredentialIds, "t.");
    appendAccountKeysFilter(tConditions, tValues, params.accounts, "t.");
    const row = db
      .prepare(
        `${TRANSACTION_LIST_SELECT}
         WHERE ${tConditions.join(" AND ")}
         ORDER BY ABS(t.charged_amount) DESC, t.id DESC
         LIMIT 1`
      )
      .get(...tValues);
    return row ? mapTransactionRow(row) : null;
  };

  const topMerchantsRows = db
    .prepare(
      `SELECT description,
              SUM(ABS(charged_amount)) as total,
              COUNT(*) as count
       FROM transactions
       WHERE ${baseWhere} AND charged_amount < 0
       GROUP BY description
       ORDER BY total DESC
       LIMIT 5`
    )
    .all(...baseValues) as { description: string; total: number; count: number }[];

  const notCountedConditions = [
    "workspace_id = ?",
    "date(date, 'localtime') >= ?",
    "date(date, 'localtime') <= ?",
    "status = 'completed'",
    "charged_amount < 0",
    `(kind = 'transfer' OR ${notCountedSql()})`,
    scopeSql(),
  ];
  const notCountedValues: (string | number)[] = [workspaceId, from, to];
  appendCredentialIdsFilter(notCountedConditions, notCountedValues, summaryCredentialIds);
  appendAccountKeysFilter(notCountedConditions, notCountedValues, params.accounts);
  const notCountedAgg = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE ${notCountedConditions.join(" AND ")}`
    )
    .get(...notCountedValues) as { total: number; count: number };

  return {
    income: {
      total: incomeAgg.total,
      count: incomeAgg.count,
      largest: pickLargest("income"),
    },
    expense: {
      total: expenseAgg.total,
      count: expenseAgg.count,
      largest: pickLargest("expense"),
    },
    net: incomeAgg.total - expenseAgg.total,
    notCounted: notCountedAgg,
    topMerchants: topMerchantsRows,
    // The review queue isn't scoped to a month or account: Home and
    // Transactions must show the same number.
    pendingReviewCount: countReviewQueue(workspaceId),
    uncategorizedCount: countUncategorized(workspaceId),
  };
}

/** Rows AI categorization would pick up. Workspace-wide like the review queue. */
export function countUncategorized(workspaceId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE workspace_id = ? AND category_id IS NULL AND kind != 'transfer'
         AND status = 'completed' AND is_excluded = 0`
    )
    .get(workspaceId) as { count: number };
  return row.count;
}

/** Transactions waiting in the review queue. Single source for every badge. */
export function countReviewQueue(workspaceId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE workspace_id = ? AND needs_review = 1 AND status = 'completed'
         AND is_excluded = 0`
    )
    .get(workspaceId) as { count: number };
  return row.count;
}

export function getNeedsReviewCountByCategory(
  workspaceId: number,
  from: string,
  to: string
): NeedsReviewCount[] {
  return getDb()
    .prepare(
      `SELECT category_id as categoryId, COUNT(*) as count
       FROM transactions
       WHERE workspace_id = ? AND date(date, 'localtime') >= ? AND date(date, 'localtime') <= ?
         AND status = 'completed'
         AND kind = 'expense'
         AND needs_review = 1
         AND ${scopeSql()}
         AND category_id IS NOT NULL
       GROUP BY category_id`
    )
    .all(workspaceId, from, to) as NeedsReviewCount[];
}
