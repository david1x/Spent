import "server-only";

import type Database from "better-sqlite3";
import { normalizeCurrency } from "@/lib/currency";
import { getFxRate, localDay } from "./fx-rates";

/** Used only when no converted purchase in that currency exists yet. */
const FALLBACK_RATES: Record<string, number> = { USD: 3.1, EUR: 3.5, GBP: 4.1 };

/** Same symbol mapping as normalizeCurrency, in SQL. */
const NORMALIZED_SQL = `CASE original_currency
  WHEN '$' THEN 'USD' WHEN '€' THEN 'EUR' WHEN '£' THEN 'GBP'
  ELSE upper(original_currency) END`;

/**
 * Shekel estimate for a foreign purchase the card bills in its own currency
 * (see migration 025): the Bank of Israel representative rate on the purchase
 * day, which is what the card companies' own conversions match. For a
 * currency or day with no stored rate, the rate implied by the user's other
 * converted purchases in that currency, then a rough fallback.
 */
export function estimateIlsCharge(
  db: Database.Database,
  currency: string,
  originalAmount: number,
  dateIso: string
): number | null {
  const code = normalizeCurrency(currency);
  const official = getFxRate(db, code, localDay(dateIso));
  if (official !== null) return Math.round(originalAmount * official * 100) / 100;
  const base = `SELECT AVG(ABS(charged_amount) / ABS(original_amount)) AS rate
    FROM transactions
    WHERE ${NORMALIZED_SQL} = ?
      AND type = 'normal'
      AND charged_estimated = 0
      AND original_amount <> 0
      AND charged_amount <> original_amount`;
  const near = db
    .prepare(`${base} AND ABS(julianday(date) - julianday(?)) <= 120`)
    .get(code, dateIso) as { rate: number | null };
  const rate =
    near.rate ??
    (db.prepare(base).get(code) as { rate: number | null }).rate ??
    FALLBACK_RATES[code] ??
    null;
  if (rate === null) return null;
  return Math.round(originalAmount * rate * 100) / 100;
}

/** True when a foreign purchase's "charged" amount is still the foreign amount. */
export function needsIlsEstimate(
  originalCurrency: string,
  originalAmount: number,
  chargedAmount: number
): boolean {
  return (
    normalizeCurrency(originalCurrency) !== "ILS" &&
    originalAmount !== 0 &&
    chargedAmount === originalAmount
  );
}
