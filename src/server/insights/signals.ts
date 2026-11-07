import "server-only";

import type { InsightRow } from "./data";
import type {
  FeesSummary,
  IncomeInfo,
  MerchantMergeSuggestion,
  RecurringSeries,
  RefundItem,
} from "@/lib/insights-types";
import { normalizeCurrency } from "@/lib/currency";
import { addDays, daysBetween, median, quantile } from "./math";
import { distinctiveWords } from "./merchant";

export interface DuplicatePair {
  a: InsightRow;
  b: InsightRow;
}

/**
 * Same card, merchant and amount within two days. A pattern that repeats
 * across months (two seats of one service) is left alone.
 */
export function findDuplicates(rows: InsightRow[], keys: Map<string, string>, today: string): DuplicatePair[] {
  const since = addDays(today, -45);
  const byKey = new Map<string, InsightRow[]>();
  for (const r of rows) {
    if (r.amount > -20 || r.isInstallment || r.kind === "transfer") continue;
    const k = [r.credentialId, r.accountNumber, keys.get(r.description), r.amount].join("|");
    const g = byKey.get(k) ?? [];
    g.push(r);
    byKey.set(k, g);
  }
  const out: DuplicatePair[] = [];
  for (const g of byKey.values()) {
    if (g.length < 2) continue;
    const pairs: DuplicatePair[] = [];
    for (let i = 1; i < g.length; i++) {
      if (daysBetween(g[i - 1].day, g[i].day) <= 2) pairs.push({ a: g[i - 1], b: g[i] });
    }
    // A pattern, not a mistake: the same pairs across months, or a chain of
    // equal charges every day or two (ad billing, tolls).
    const months = new Set(pairs.map((p) => p.a.day.slice(0, 7)));
    if (months.size >= 2 || pairs.length >= 2) continue;
    const recentSame = g.filter((r) => r.day >= addDays(today, -30)).length;
    if (recentSame >= 3) continue;
    for (const p of pairs) if (p.b.day >= since) out.push(p);
  }
  return out;
}

export interface LargeCharge {
  row: InsightRow;
  threshold: number;
  firstTime: boolean;
}

/** Big for you: over ₪500 and over this category's usual top end, or a big first purchase somewhere new. */
export function largeCharges(
  rows: InsightRow[],
  keys: Map<string, string>,
  today: string,
  isFixed: (r: InsightRow) => boolean
): LargeCharge[] {
  const since = addDays(today, -30);
  const yearAgo = addDays(today, -365);
  const byCategory = new Map<number | null, number[]>();
  const firstSeen = new Map<string, string>();
  for (const r of rows) {
    const k = keys.get(r.description) ?? r.description;
    if (!firstSeen.has(k)) firstSeen.set(k, r.day);
    if (r.amount >= 0 || !r.counted || r.day < yearAgo) continue;
    const list = byCategory.get(r.categoryId) ?? [];
    list.push(-r.amount);
    byCategory.set(r.categoryId, list);
  }
  const out: LargeCharge[] = [];
  for (const r of rows) {
    if (r.day < since || r.amount >= 0 || !r.counted || r.isInstallment || isFixed(r)) continue;
    const amounts = byCategory.get(r.categoryId) ?? [];
    const threshold = Math.max(500, quantile(amounts, 0.95), 3 * median(amounts));
    const firstTime = firstSeen.get(keys.get(r.description) ?? r.description) === r.day;
    const big = -r.amount >= threshold;
    const bigNew = firstTime && -r.amount >= Math.max(300, quantile(amounts, 0.9));
    if (big || bigNew) out.push({ row: r, threshold: Math.round(threshold), firstTime });
  }
  return out.sort((a, b) => a.row.amount - b.row.amount).slice(0, 3);
}

/** Person-to-person and own-account movements, never refunds. */
const TRANSFER_PATTERN = /העברה|הפקדה|העב'|bit\b|paybox|pepper|transfer|deposit/i;

/** Money back at a merchant you paid before, in the last 45 days. */
export function recentRefunds(rows: InsightRow[], keys: Map<string, string>, today: string): RefundItem[] {
  const since = addDays(today, -45);
  const paidAt = new Map<string, number>();
  const out: RefundItem[] = [];
  for (const r of rows) {
    const k = keys.get(r.description) ?? r.description;
    if (r.amount < 0) {
      paidAt.set(k, Math.max(paidAt.get(k) ?? 0, -r.amount));
      continue;
    }
    if (r.day < since || r.kind === "transfer" || r.amount < 10 || TRANSFER_PATTERN.test(r.description)) continue;
    const refundCategory = r.categoryName === "Refunds & Reimbursements";
    // Money back at a merchant you paid, no more than you paid there.
    const maxPaid = paidAt.get(k) ?? 0;
    const looksLikeRefund = maxPaid > 0 && r.amount <= maxPaid * 1.2 && r.categoryName !== "Salary";
    if (refundCategory || looksLikeRefund) {
      out.push({ id: r.id, merchant: r.description, amount: r.amount, date: r.day });
    }
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 6);
}

/** Bank and card fees, interest, and the like. Arnona and other taxes are not fees. */
const FEE_PATTERN = /עמל|דמי כרטיס|דמי ניהול|דמי חבר|ריבית|fee\b|fees\b|commission|interest/i;

export function feesSummary(rows: InsightRow[], keys: Map<string, string>, today: string): FeesSummary {
  const since = addDays(today, -365);
  const lines = new Map<string, { merchant: string; total: number; count: number; lastDate: string }>();
  let foreignSpend = 0;
  let foreignCount = 0;
  for (const r of rows) {
    if (r.day < since || r.amount >= 0) continue;
    if (r.counted && normalizeCurrency(r.originalCurrency) !== "ILS") {
      foreignSpend -= r.amount;
      foreignCount++;
    }
    const isFee = r.categoryName === "Bank Fees" || FEE_PATTERN.test(r.description) || (r.memo !== null && FEE_PATTERN.test(r.memo));
    if (!isFee) continue;
    const k = keys.get(r.description) ?? r.description;
    const line = lines.get(k) ?? { merchant: r.description, total: 0, count: 0, lastDate: r.day };
    line.total -= r.amount;
    line.count++;
    line.lastDate = r.day;
    lines.set(k, line);
  }
  const list = [...lines.values()].map((l) => ({ ...l, total: Math.round(l.total * 100) / 100 })).sort((a, b) => b.total - a.total);
  return {
    lines: list.slice(0, 10),
    total12m: Math.round(list.reduce((s, l) => s + l.total, 0) * 100) / 100,
    foreignSpend12m: Math.round(foreignSpend),
    foreignCount,
  };
}

/**
 * The main income: the largest regular monthly deposit. Tells whether this
 * month's has arrived and whether it changed.
 */
export function incomeInfo(
  rows: InsightRow[],
  keys: Map<string, string>,
  series: RecurringSeries[],
  today: string
): IncomeInfo | null {
  const salary = series
    .filter((s) => s.direction === "income" && s.cadence === "monthly" && s.counted && s.status !== "missing" && !s.cancelledAt)
    .sort((a, b) => b.typical - a.typical)[0];
  if (!salary) return null;
  const deposits = rows
    .filter((r) => r.amount > 0 && (keys.get(r.description) ?? r.description) === salary.merchantKey)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  if (deposits.length < 3) return null;
  const recent = deposits.slice(-6);
  const expectedDay = Math.round(median(recent.map((r) => Number(r.day.slice(8, 10)))));
  const [y, m] = today.split("-").map(Number);
  const lastOfMonth = new Date(y, m, 0).getDate();
  const expected = `${today.slice(0, 7)}-${String(Math.min(expectedDay, lastOfMonth)).padStart(2, "0")}`;
  const last = deposits[deposits.length - 1];
  const arrived = Math.abs(daysBetween(expected, last.day)) <= 10;
  const status: IncomeInfo["status"] = arrived ? "received" : daysBetween(expected, today) > 3 ? "late" : "upcoming";
  const previous = deposits.slice(-4, -1).map((r) => r.amount);
  const typical = median(previous);
  const change = typical > 0 ? last.amount / typical - 1 : null;
  return {
    merchant: salary.merchant,
    seriesKey: salary.key,
    typical: Math.round(typical),
    last: Math.round(last.amount),
    lastDate: last.day,
    expectedDay,
    status,
    change: change !== null && Math.abs(change) >= 0.05 ? Math.round(change * 1000) / 1000 : null,
  };
}

/**
 * Two merchant names that are probably one company ("סלקום ישראל" and
 * "חשבון לשרותי סלקום"): they share a distinctive word, at least one is a
 * recurring charge, and they aren't merged already.
 */
export function mergeSuggestions(
  rows: InsightRow[],
  keys: Map<string, string>,
  series: RecurringSeries[],
  today: string,
  dismissed: Set<string>
): MerchantMergeSuggestion[] {
  const since = addDays(today, -365);
  const names = new Map<string, { name: string; count: number; out: boolean }>();
  for (const r of rows) {
    if (r.day < since || r.kind === "transfer") continue;
    const k = keys.get(r.description) ?? r.description;
    const n = names.get(k) ?? { name: r.description, count: 0, out: r.amount < 0 };
    n.count++;
    n.name = r.description;
    names.set(k, n);
  }
  const recurringKeys = new Set(series.map((s) => s.merchantKey));
  const amounts = new Map<string, number[]>();
  for (const r of rows) {
    if (r.day < since) continue;
    const k = keys.get(r.description) ?? r.description;
    amounts.set(k, [...(amounts.get(k) ?? []), Math.abs(r.amount)]);
  }
  const byWord = new Map<string, string[]>();
  for (const k of names.keys()) {
    for (const w of distinctiveWords(k)) {
      const list = byWord.get(w) ?? [];
      list.push(k);
      byWord.set(w, list);
    }
  }
  const seen = new Set<string>();
  const out: MerchantMergeSuggestion[] = [];
  for (const list of byWord.values()) {
    if (list.length < 2 || list.length > 3) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]].sort();
        const id = `merge:${a}|${b}`;
        if (seen.has(id) || dismissed.has(id)) continue;
        seen.add(id);
        const na = names.get(a)!;
        const nb = names.get(b)!;
        if (na.out !== nb.out) continue;
        // Exactly one recurring: two recurring names are two separate charges
        // (car and life insurance from one insurer).
        if (recurringKeys.has(a) === recurringKeys.has(b)) continue;
        const ma = median(amounts.get(a) ?? []);
        const mb = median(amounts.get(b) ?? []);
        if (ma > 0 && mb > 0 && Math.max(ma, mb) / Math.min(ma, mb) > 3) continue;
        // `a` is the recurring name: merging keeps its series key stable.
        const first = recurringKeys.has(a) ? { key: a, name: na.name } : { key: b, name: nb.name };
        const second = recurringKeys.has(a) ? { key: b, name: nb.name } : { key: a, name: na.name };
        out.push({ a: first, b: second });
      }
    }
  }
  return out.slice(0, 5);
}
