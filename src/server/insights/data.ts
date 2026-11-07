import "server-only";

import { getDb } from "../db";
import { scopeSql } from "../lib/scope";
import { countedSql } from "../db/queries/counted";
import { toLocalISODate } from "../lib/date-utils";

/** One transaction as the insight engine sees it. */
export interface InsightRow {
  id: number;
  /** Local day of the transaction (YYYY-MM-DD). */
  day: string;
  /** Local day it is charged to the card or account. */
  chargeDay: string;
  /** Signed: negative is money out. */
  amount: number;
  description: string;
  memo: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  kind: "expense" | "income" | "transfer";
  isInstallment: boolean;
  installmentNumber: number | null;
  installmentTotal: number | null;
  originalAmount: number;
  originalCurrency: string;
  credentialId: number | null;
  accountNumber: string;
  provider: string;
  status: "completed" | "pending";
  /** Counts toward spending and income totals (not excluded, not a transfer category). */
  counted: boolean;
}

/** History the engine reads: enough for annual subscriptions seen twice. */
export const HISTORY_DAYS = 800;

export function loadInsightRows(workspaceId: number, today: Date): InsightRow[] {
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - HISTORY_DAYS);
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.date, t.processed_date, t.charged_amount, t.description, t.memo,
              t.category_id, c.name AS category_name, c.color AS category_color,
              t.kind, t.type, t.installment_number, t.installment_total,
              t.original_amount, t.original_currency, t.credential_id, t.account_number, t.provider,
              t.status,
              CASE WHEN t.kind != 'transfer' AND ${countedSql("t")} THEN 1 ELSE 0 END AS counted
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = ?
         AND date(t.date, 'localtime') >= ?
         AND ${scopeSql("t")}
       ORDER BY t.date ASC, t.id ASC`
    )
    .all(workspaceId, toLocalISODate(since)) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as number,
    day: toLocalISODate(new Date(r.date as string)),
    chargeDay: toLocalISODate(new Date(r.processed_date as string)),
    amount: r.charged_amount as number,
    description: r.description as string,
    memo: (r.memo as string | null) ?? null,
    categoryId: (r.category_id as number | null) ?? null,
    categoryName: (r.category_name as string | null) ?? null,
    categoryColor: (r.category_color as string | null) ?? null,
    kind: r.kind as InsightRow["kind"],
    isInstallment: r.type === "installments",
    installmentNumber: (r.installment_number as number | null) ?? null,
    installmentTotal: (r.installment_total as number | null) ?? null,
    originalAmount: r.original_amount as number,
    originalCurrency: r.original_currency as string,
    credentialId: (r.credential_id as number | null) ?? null,
    accountNumber: r.account_number as string,
    provider: r.provider as string,
    status: r.status as InsightRow["status"],
    counted: r.counted === 1,
  }));
}
