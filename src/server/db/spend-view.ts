import "server-only";

import type Database from "better-sqlite3";

/**
 * `spend_rows`: the transactions table as spending totals should see it. A
 * row spread over N months (transactions.spread_months) becomes N rows, one
 * per month, each with 1/N of the amount, dated the same day of each month
 * (the last day when a month is shorter). Every other row passes through
 * as is. Budgets, Home, Over time and category totals read from it; lists of
 * transactions keep reading the real rows.
 *
 * It is a TEMP view, so it lives on the connection and never in the database
 * file: migrations that rebuild the transactions table can't trip over it, and
 * a backup holds only real data. It is rebuilt from the table's current
 * columns every time migrations run.
 */
export const SPEND_ROWS = "spend_rows";

/** Longest spread the app accepts: five years of monthly parts. */
export const MAX_SPREAD_MONTHS = 60;

export function dropSpendView(db: Database.Database): void {
  db.exec(`DROP VIEW IF EXISTS temp.${SPEND_ROWS}`);
}

export function createSpendView(db: Database.Database): void {
  const columns = (db.prepare("PRAGMA main.table_info(transactions)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!columns.includes("spread_months")) return;

  // Local day of the payment, then the same day i months later, clamped to
  // the month's length (date(..., '+1 months') would roll Jan 31 into March).
  const local = "date(t.date, 'localtime')";
  const month = `date(${local}, 'start of month', '+' || n.i || ' months')`;
  const monthLength = `CAST(strftime('%d', date(${month}, '+1 month', '-1 day')) AS INTEGER)`;
  const day = `MIN(CAST(strftime('%d', ${local}) AS INTEGER), ${monthLength})`;
  const partDay = `date(${month}, '+' || (${day} - 1) || ' days')`;
  // Back to a UTC timestamp at the payment's time of day, like the real rows,
  // so date(date, 'localtime') in the queries lands on partDay.
  const partDate = `strftime('%Y-%m-%dT%H:%M:%fZ', ${partDay} || ' ' || time(t.date, 'localtime'), 'utc')`;

  const quote = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const plain = columns.map((c) => `t.${quote(c)}`).join(", ");
  const parted = columns
    .map((c) => {
      if (c === "date") return `${partDate} AS "date"`;
      if (c === "charged_amount") return `t.charged_amount * 1.0 / t.spread_months AS "charged_amount"`;
      return `t.${quote(c)}`;
    })
    .join(", ");

  dropSpendView(db);
  db.exec(`
    CREATE TEMP VIEW ${SPEND_ROWS} AS
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_SPREAD_MONTHS - 1})
    SELECT ${plain}, 0 AS spread_part
    FROM main.transactions t
    WHERE t.spread_months IS NULL OR t.spread_months < 2
    UNION ALL
    SELECT ${parted}, n.i AS spread_part
    FROM main.transactions t
    JOIN n ON n.i < t.spread_months
    WHERE t.spread_months >= 2
  `);
}
