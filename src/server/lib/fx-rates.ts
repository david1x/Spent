import "server-only";

import type Database from "better-sqlite3";
import seed from "../data/fx-rates.json";
import { normalizeCurrency } from "@/lib/currency";

/** Currencies fetched from the Bank of Israel. */
export const FX_CURRENCIES = ["USD", "EUR", "GBP"] as const;

/** A rate older than this (weekends, holidays) is still used; past it, no rate. */
const MAX_GAP_DAYS = 10;

interface SeedFile {
  fetchedAt: string;
  rates: Record<string, Array<[string, number]>>;
}

/** Local calendar day of an ISO timestamp, the day the bank used to convert. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Copies the bundled rates into the table when the table is behind the file. */
export function seedFxRates(db: Database.Database): void {
  // JSON imports widen tuples to arrays; the generator writes [day, rate] pairs.
  const file = seed as unknown as SeedFile;
  const latest = db.prepare("SELECT MAX(date) AS d FROM fx_rates").get() as { d: string | null };
  if (latest.d && latest.d >= file.fetchedAt) return;
  const insert = db.prepare("INSERT OR IGNORE INTO fx_rates (currency, date, rate) VALUES (?, ?, ?)");
  db.transaction(() => {
    for (const [currency, rows] of Object.entries(file.rates)) {
      for (const [date, rate] of rows) insert.run(currency, date, rate);
    }
  })();
}

/** The representative rate in effect on `day`: that day's, or the last one before it. */
export function getFxRate(db: Database.Database, currency: string, day: string): number | null {
  const row = db
    .prepare(
      `SELECT rate, julianday(?) - julianday(date) AS gap FROM fx_rates
       WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1`
    )
    .get(day, normalizeCurrency(currency), day) as { rate: number; gap: number } | undefined;
  return row && row.gap <= MAX_GAP_DAYS ? row.rate : null;
}

/**
 * Recomputes every estimated shekel amount from the rate on its purchase day.
 * Cheap (a few dozen rows), so it runs on startup and after each rate update.
 * Returns how many rows changed.
 */
export function refreshEstimatedCharges(db: Database.Database): number {
  const rows = db
    .prepare(
      "SELECT id, date, original_amount AS amount, original_currency AS currency, charged_amount AS charged FROM transactions WHERE charged_estimated = 1"
    )
    .all() as Array<{ id: number; date: string; amount: number; currency: string; charged: number }>;
  const update = db.prepare("UPDATE transactions SET charged_amount = ? WHERE id = ?");
  let changed = 0;
  db.transaction(() => {
    for (const r of rows) {
      const rate = getFxRate(db, r.currency, localDay(r.date));
      if (rate === null) continue;
      const next = Math.round(r.amount * rate * 100) / 100;
      if (next !== r.charged) {
        update.run(next, r.id);
        changed++;
      }
    }
  })();
  return changed;
}

export interface FxStatus {
  /** Newest day with a rate, across currencies. */
  latestDate: string | null;
  currencies: string[];
  /** Transactions whose shekel amount is an estimate. */
  estimatedCount: number;
}

export function getFxStatus(db: Database.Database): FxStatus {
  const latest = db.prepare("SELECT MAX(date) AS d FROM fx_rates").get() as { d: string | null };
  const currencies = (db.prepare("SELECT DISTINCT currency FROM fx_rates ORDER BY currency").all() as Array<{ currency: string }>).map((r) => r.currency);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE charged_estimated = 1").get() as { n: number };
  return { latestDate: latest.d, currencies, estimatedCount: n };
}

/**
 * Fetches the days since the newest stored rate (plus a week of overlap, since
 * the bank sometimes revises a day) and refreshes the estimates. Sends only
 * the currency and date range to the Bank of Israel.
 */
export async function updateFxRates(db: Database.Database): Promise<{ added: number; changed: number; latestDate: string | null }> {
  const latest = db.prepare("SELECT MAX(date) AS d FROM fx_rates").get() as { d: string | null };
  const start = new Date(latest.d ?? "2000-01-01");
  if (latest.d) start.setDate(start.getDate() - 7);
  else start.setFullYear(new Date().getFullYear() - 2);
  const from = start.toISOString().slice(0, 10);
  const to = localDay(new Date().toISOString());

  const upsert = db.prepare(
    "INSERT INTO fx_rates (currency, date, rate) VALUES (?, ?, ?) ON CONFLICT(currency, date) DO UPDATE SET rate = excluded.rate"
  );
  const before = (db.prepare("SELECT COUNT(*) AS n FROM fx_rates").get() as { n: number }).n;
  for (const currency of FX_CURRENCIES) {
    const rows = await fetchBoiRates(currency, from, to);
    db.transaction(() => {
      for (const [date, rate] of rows) upsert.run(currency, date, rate);
    })();
  }
  const after = (db.prepare("SELECT COUNT(*) AS n FROM fx_rates").get() as { n: number }).n;
  const changed = refreshEstimatedCharges(db);
  return { added: after - before, changed, latestDate: getFxStatus(db).latestDate };
}

async function fetchBoiRates(currency: string, from: string, to: string): Promise<Array<[string, number]>> {
  const url =
    "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/" +
    `RER_${currency}_ILS?format=csv&startperiod=${from}&endperiod=${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Bank of Israel returned ${res.status} for ${currency}`);
  const [header = "", ...lines] = (await res.text()).trim().split(/\r?\n/);
  const cols = header.split(",");
  const iDate = cols.indexOf("TIME_PERIOD");
  const iValue = cols.indexOf("OBS_VALUE");
  const iMult = cols.indexOf("UNIT_MULT");
  if (iDate < 0 || iValue < 0) throw new Error("Bank of Israel sent an unexpected format");
  return lines
    .map((line) => line.split(","))
    .map((f): [string, number] => [f[iDate], Number(f[iValue]) / 10 ** Number(iMult >= 0 ? f[iMult] || 0 : 0)])
    .filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && v > 0);
}
