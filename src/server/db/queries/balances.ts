import "server-only";

import { getDb } from "../index";
import { normalizeCurrency } from "@/lib/currency";
import { scopeSql } from "@/server/lib/scope";
import type { ScrapedAccount } from "@/server/scrapers/types";

export interface AccountBalanceRow {
  credentialId: number;
  provider: string;
  label: string | null;
  accountNumber: string;
  /** In the account's own currency. */
  balance: number;
  currency: string;
  savings: boolean;
  /** UTC, SQLite format. */
  updatedAt: string;
}

/**
 * Keeps the balance each account reported on this sync. An account the
 * bank left out this time (a page that failed to load) keeps its last one;
 * its date shows how old it is.
 */
export function saveAccountBalances(credentialId: number, accounts: ScrapedAccount[]): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO account_balances (credential_id, account_number, balance, currency, savings, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(credential_id, account_number) DO UPDATE SET
       balance = excluded.balance, currency = excluded.currency,
       savings = excluded.savings, updated_at = excluded.updated_at`
  );
  db.transaction(() => {
    for (const a of accounts) {
      if (a.balance === undefined) continue;
      upsert.run(credentialId, a.accountNumber, a.balance, normalizeCurrency(a.currency ?? "ILS"), a.savings ? 1 : 0);
    }
  })();
}

/**
 * A balance read from an imported file, as of the file's latest row. Kept
 * only when it isn't older than the one already known, so importing an old
 * file never rolls back a synced balance. True when it was kept.
 */
export function saveImportedBalance(credentialId: number, accountNumber: string, balance: number, asOf: Date): boolean {
  const at = asOf.toISOString().replace("T", " ").slice(0, 19);
  const res = getDb()
    .prepare(
      `INSERT INTO account_balances (credential_id, account_number, balance, currency, savings, updated_at)
       VALUES (?, ?, ?, 'ILS', 0, ?)
       ON CONFLICT(credential_id, account_number) DO UPDATE SET
         balance = excluded.balance, currency = excluded.currency, updated_at = excluded.updated_at
       WHERE excluded.updated_at >= account_balances.updated_at`
    )
    .run(credentialId, accountNumber, balance, at);
  return res.changes > 0;
}

/** The latest balance of every bank account in the workspace (and the selected accounts, if any). */
export function listAccountBalances(workspaceId: number): AccountBalanceRow[] {
  const rows = getDb()
    .prepare(
      `SELECT b.credential_id, c.provider, c.label, b.account_number, b.balance, b.currency, b.savings, b.updated_at
       FROM account_balances b
       JOIN bank_credentials c ON c.id = b.credential_id
       WHERE c.workspace_id = ? AND ${scopeSql("b")}
       ORDER BY c.id, b.savings, b.currency != 'ILS', b.account_number`
    )
    .all(workspaceId) as Array<{
    credential_id: number;
    provider: string;
    label: string | null;
    account_number: string;
    balance: number;
    currency: string;
    savings: number;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    credentialId: r.credential_id,
    provider: r.provider,
    label: r.label,
    accountNumber: r.account_number,
    balance: r.balance,
    currency: r.currency,
    savings: r.savings === 1,
    updatedAt: r.updated_at,
  }));
}
