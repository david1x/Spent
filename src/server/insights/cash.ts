import "server-only";

import { getDb } from "../db";
import { getPeriodStartDay } from "../db/queries/settings";
import { listAccountBalances } from "../db/queries/balances";
import { estimateIlsCharge } from "../lib/fx-estimate";
import { isBankAccountProvider } from "../lib/card-bills";
import { scopeSql } from "../lib/scope";
import { periodContaining, toISODay } from "@/lib/period";
import { BANK_PROVIDERS } from "@/lib/types";
import type { CashAccount, CashEvent, CashStatus } from "@/lib/cash-types";
import { loadInsightRows } from "./data";
import { buildMerchantKeys } from "./merchant";
import { detectRecurring } from "./recurring";
import { isExpected, projectSeries } from "./plans";
import { loadFeedback } from "./feedback";
import { loadOverrides } from "./overrides";
import { addDays, addMonths } from "./math";

/** A card debit lands within a few days of the billing date (see card-bills.ts). */
const BILL_DAYS = 5;
/** A recurring item this many days overdue still counts as coming (a late salary). */
const LATE_DAYS = 10;

const CARD_PROVIDER_SQL = BANK_PROVIDERS.filter((b) => b.kind === "card")
  .map((b) => `'${b.id}'`)
  .join(", ");

const round2 = (n: number) => Math.round(n * 100) / 100;
const localDay = (iso: string) => toISODay(new Date(iso));

/**
 * The money side of things, where spending looks at purchase dates: what's
 * in the bank now, what leaves or arrives before the period ends, and what
 * that leaves. Card purchases reach the bank as one statement on the
 * billing day, so a statement whose purchases are already made is known
 * before it's paid.
 */
export function buildCashStatus(workspaceId: number, now = new Date()): CashStatus {
  const db = getDb();
  const today = toISODay(now);
  const periodEnd = toISODay(periodContaining(now, getPeriodStartDay(workspaceId)).end);

  const accounts: CashAccount[] = listAccountBalances(workspaceId).map((a) => ({
    ...a,
    balanceIls:
      a.currency === "ILS" ? a.balance : (estimateIlsCharge(db, a.currency, a.balance, now.toISOString()) ?? a.balance),
  }));
  const available = round2(accounts.filter((a) => !a.savings).reduce((s, a) => s + a.balanceIls, 0));
  const savings = round2(accounts.filter((a) => a.savings).reduce((s, a) => s + a.balanceIls, 0));
  const asOf = accounts.reduce<string | null>((m, a) => (m === null || a.updatedAt < m ? a.updatedAt : m), null);
  const hasBank =
    (db.prepare("SELECT provider FROM bank_credentials WHERE workspace_id = ?").all(workspaceId) as { provider: string }[]).some(
      (c) => isBankAccountProvider(c.provider)
    );

  const statements = cardStatements(workspaceId, today);
  // Card statements just after the period hold purchases already made, and
  // the start of a period is when most of the bank's own items land too.
  const laterEnd = statements.reduce((m, e) => (e.date > m ? e.date : m), periodEnd);
  const bills = hasBank ? bankRecurring(workspaceId, now, today, laterEnd) : [];
  const all = [...statements, ...bills];
  const events = all.filter((e) => e.date <= periodEnd).sort(byDate);
  const later = all.filter((e) => e.date > periodEnd).sort(byDate);
  const projected = round2(available + events.reduce((s, e) => s + e.amount, 0));

  return {
    hasBank,
    accounts,
    available,
    savings,
    asOf,
    today,
    periodEnd,
    events,
    projected,
    later,
    projectedAfterLater: round2(projected + later.reduce((s, e) => s + e.amount, 0)),
  };
}

const byDate = (a: CashEvent, b: CashEvent) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount);

interface CardRow {
  cid: number;
  acc: string;
  label: string | null;
  provider: string;
  pd: string;
  status: "completed" | "pending";
  amount: number;
}

/**
 * Card statements not yet paid: due after today, or due in the last few days
 * with no matching bank debit yet (only knowable for a card linked to the
 * bank that pays it). Pending purchases go on the card's next statement.
 */
function cardStatements(workspaceId: number, today: string): CashEvent[] {
  const db = getDb();
  const since = addDays(today, -(BILL_DAYS + 1));
  const rows = db
    .prepare(
      `SELECT t.credential_id AS cid, t.account_number AS acc, c.label, t.provider, t.processed_date AS pd,
              t.status, t.charged_amount AS amount
       FROM transactions t
       JOIN bank_credentials c ON c.id = t.credential_id
       WHERE t.workspace_id = ? AND t.provider IN (${CARD_PROVIDER_SQL}) AND ${scopeSql("t")}
         AND (t.status = 'pending' OR date(t.processed_date, 'localtime') >= ?)`
    )
    .all(workspaceId, since) as CardRow[];
  if (rows.length === 0) return [];

  const cardKey = (r: { cid: number; acc: string }) => `${r.cid}|${r.acc}`;
  const nextBill = new Map<string, string>();
  for (const r of rows) {
    const day = localDay(r.pd);
    if (r.status !== "completed" || day <= today) continue;
    const k = cardKey(r);
    if (!nextBill.has(k) || day < nextBill.get(k)!) nextBill.set(k, day);
  }
  const lastBill = db.prepare(
    `SELECT MAX(processed_date) AS pd FROM transactions
     WHERE workspace_id = ? AND credential_id = ? AND account_number = ? AND status = 'completed'`
  );
  const nextBillOf = (r: CardRow): string => {
    const k = cardKey(r);
    const known = nextBill.get(k);
    if (known) return known;
    // No statement scheduled yet: the next one on the card's usual billing day.
    const last = (lastBill.get(workspaceId, r.cid, r.acc) as { pd: string | null }).pd;
    let day = last ? localDay(last) : `${today.slice(0, 7)}-01`;
    for (let i = 0; i < 24 && day <= today; i++) day = addMonths(day, 1);
    nextBill.set(k, day);
    return day;
  };

  const statements = new Map<string, { row: CardRow; date: string; amount: number; count: number }>();
  for (const r of rows) {
    const pd = localDay(r.pd);
    const date = r.status === "pending" && pd <= today ? nextBillOf(r) : pd;
    const k = `${cardKey(r)}|${date}`;
    const s = statements.get(k) ?? { row: r, date, amount: 0, count: 0 };
    s.amount -= r.amount;
    s.count += 1;
    statements.set(k, s);
  }

  const linked = new Set(
    (
      db
        .prepare("SELECT card_credential_id AS cid, card_account_number AS acc FROM card_payment_links WHERE workspace_id = ?")
        .all(workspaceId) as { cid: number; acc: string }[]
    ).map(cardKey)
  );
  const paidStmt = db.prepare(
    `SELECT 1 FROM transactions
     WHERE workspace_id = ? AND card_bill_credential_id = ?
       AND (',' || card_bill_accounts || ',') LIKE ('%,' || ? || ',%')
       AND ABS(julianday(date(date, 'localtime')) - julianday(?)) <= ${BILL_DAYS}
     LIMIT 1`
  );
  const latest = new Map<string, string>();
  for (const s of statements.values()) {
    const k = cardKey(s.row);
    if (!latest.has(k) || s.date > latest.get(k)!) latest.set(k, s.date);
  }

  const out: CashEvent[] = [];
  for (const s of statements.values()) {
    if (s.amount <= 0) continue;
    if (s.date <= today) {
      // Already due: unpaid only while a linked bank shows no debit for it.
      if (!linked.has(cardKey(s.row))) continue;
      if (paidStmt.get(workspaceId, s.row.cid, s.row.acc, s.date)) continue;
    }
    const open = s.date > today && latest.get(cardKey(s.row)) === s.date;
    out.push({
      date: s.date,
      kind: "card_bill",
      label: s.row.label?.trim() || s.row.provider,
      amount: -round2(s.amount),
      estimated: open,
      card: { credentialId: s.row.cid, accountNumber: s.row.acc, count: s.count, open },
    });
  }
  return out;
}

/**
 * Recurring bank debits and income (rent, loans, salary) expected after
 * today through `until`, plus any due in the last few days that haven't
 * arrived. Balances come from the same sync as the rows, so a missing
 * salary isn't in the balance either.
 */
function bankRecurring(workspaceId: number, now: Date, today: string, until: string): CashEvent[] {
  const rows = loadInsightRows(workspaceId, now).filter((r) => isBankAccountProvider(r.provider));
  if (rows.length === 0) return [];
  const feedback = loadFeedback(workspaceId, now);
  const keys = buildMerchantKeys(workspaceId, rows.map((r) => r.description));
  const series = detectRecurring(rows, keys, {
    today,
    historyStart: rows[0].day,
    excluded: feedback.notRecurring,
    overrides: loadOverrides(workspaceId),
  });
  const out: CashEvent[] = [];
  for (const s of series) {
    if (!isExpected(s)) continue;
    for (const date of projectSeries(s, until)) {
      if (date < addDays(today, -LATE_DAYS)) continue;
      out.push({
        date,
        kind: s.direction === "income" ? "income" : "bill",
        label: s.merchant,
        amount: s.direction === "income" ? s.typical : -s.typical,
        estimated: s.variable,
        ...(date <= today ? { late: true } : {}),
      });
    }
  }
  return out;
}
