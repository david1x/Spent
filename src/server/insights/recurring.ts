import "server-only";

import type { InsightRow } from "./data";
import type { RecurringCadence, RecurringSeries } from "@/lib/insights-types";
import { addDays, addMonths, daysBetween, median, quantile } from "./math";

interface CadenceSpec {
  cadence: RecurringCadence;
  days: number;
  /** Allowed drift of one gap, in days. */
  tol: number;
  perYear: number;
  /** Charges needed before a series counts. */
  minCount: number;
  /** Days past the expected date before it counts as missing. */
  grace: number;
  next: (day: string) => string;
}

const CADENCES: CadenceSpec[] = [
  { cadence: "weekly", days: 7, tol: 2, perYear: 52, minCount: 4, grace: 4, next: (d) => addDays(d, 7) },
  { cadence: "monthly", days: 30.4, tol: 6, perYear: 12, minCount: 3, grace: 8, next: (d) => addMonths(d, 1) },
  { cadence: "bimonthly", days: 61, tol: 9, perYear: 6, minCount: 3, grace: 12, next: (d) => addMonths(d, 2) },
  { cadence: "quarterly", days: 91, tol: 12, perYear: 4, minCount: 3, grace: 15, next: (d) => addMonths(d, 3) },
  { cadence: "annual", days: 365, tol: 20, perYear: 1, minCount: 2, grace: 30, next: (d) => addMonths(d, 12) },
];

/** Seeded category names (English) for bills with little room to shop around. */
const ESSENTIAL_CATEGORIES = new Set(["Bills & Utilities", "Health", "Education", "Kids & Childcare"]);
/**
 * Everyday spending: frequent and loosely regular, never a subscription unless
 * the amount is fixed (a gym inside a grocery chain's app, say).
 */
const EVERYDAY_CATEGORIES = new Set([
  "Groceries", "Restaurants", "Coffee & Cafes", "Shopping", "Transport", "Food", "Cash & ATM",
]);

/** How far an amount may drift and still be "the same price". */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.02 * Math.max(a, b));
}

/** A real price step, as opposed to rounding: over ₪2 and over 5%. */
function priceStep(from: number, to: number): boolean {
  return Math.abs(to - from) > Math.max(2, 0.05 * from);
}

interface Occurrence {
  day: string;
  amount: number;
  row: InsightRow;
}

/** What the user said about one series (recurring_overrides). */
export interface RecurringOverride {
  key: string;
  merchantKey: string;
  direction: "out" | "in";
  cadence: RecurringCadence | null;
  cancelledAt: string | null;
  manual: boolean;
}

export interface DetectOptions {
  today: string;
  /** First day with any data, so long-running series aren't called "new". */
  historyStart: string;
  /** Series keys the user marked "not recurring". */
  excluded: Set<string>;
  /** User overrides by series key. */
  overrides?: Map<string, RecurringOverride>;
}

const specFor = (c: RecurringCadence) => CADENCES.find((x) => x.cadence === c)!;

/** Canceled series stay listed this long after their last charge. */
const CANCELLED_VISIBLE_DAYS = 400;

export function detectRecurring(
  rows: InsightRow[],
  merchantKeys: Map<string, string>,
  options: DetectOptions
): RecurringSeries[] {
  const groups = new Map<string, Occurrence[]>();
  for (const row of rows) {
    if (row.kind === "transfer" || row.isInstallment || row.amount === 0) continue;
    const key = merchantKeys.get(row.description) ?? row.description;
    const direction = row.amount < 0 ? "out" : "in";
    const g = groups.get(`${key}|${direction}`) ?? [];
    g.push({ day: row.day, amount: Math.abs(row.amount), row });
    groups.set(`${key}|${direction}`, g);
  }

  const out: RecurringSeries[] = [];
  for (const [groupKey, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    const [merchantKey, direction] = groupKey.split("|") as [string, "out" | "in"];
    // The whole merchant first; when that has no rhythm, split by amount, so
    // a monthly fee and occasional extra charges at the same company (or two
    // subscriptions billed by one company) are judged apart.
    const whole = evaluate(merchantKey, direction, withoutSideCharges(occurrences), false, options);
    const found = whole
      ? [whole]
      : clusterByAmount(occurrences)
          .map((c) => evaluate(merchantKey, direction, c, true, options))
          .filter((x): x is RecurringSeries => x !== null);
    for (const series of found) if (!options.excluded.has(series.key)) out.push(series);
  }

  // The user's word wins: a set frequency re-reads the charges with it, and
  // a series they track by hand is built even if detection never found it.
  const overrides = options.overrides ?? new Map<string, RecurringOverride>();
  for (const o of overrides.values()) {
    if (options.excluded.has(o.key)) continue;
    const index = out.findIndex((x) => x.key === o.key);
    const detected = index >= 0 ? out[index] : null;
    if (!o.cadence && !o.manual && !o.cancelledAt) continue;
    if (!detected || (o.cadence && o.cadence !== detected.cadence)) {
      const occ = groups.get(`${o.merchantKey}|${o.direction}`) ?? [];
      const suffix = o.key.slice(`${o.merchantKey}|${o.direction}`.length);
      const center = suffix.startsWith("@") ? Number(suffix.slice(1)) : null;
      const picked = center === null ? occ : occ.filter((x) => Math.abs(x.amount - center) <= Math.max(2, 0.12 * center));
      const cadence = o.cadence ?? detected?.cadence ?? "monthly";
      const forced = picked.length > 0
        ? evaluate(o.merchantKey, o.direction, picked, center !== null, options, specFor(cadence), suffix)
        : null;
      if (forced) {
        forced.userCadence = o.cadence !== null;
        forced.manual = o.manual && !detected;
        if (index >= 0) out[index] = forced;
        else out.push(forced);
      }
    } else if (o.cadence) {
      detected.userCadence = true;
    }
  }
  for (const series of out) {
    const o = overrides.get(series.key);
    if (o?.cancelledAt) applyCancellation(series, o.cancelledAt, groups, options.today);
  }
  return out
    .filter((x) => !(x.status === "cancelled" && daysBetween(x.lastDate, options.today) > CANCELLED_VISIBLE_DAYS))
    .sort((a, b) => b.annual - a.annual);
}

/**
 * A canceled series expects nothing more. A charge after the cancel day is
 * the one thing worth flagging: the subscription may not really be closed.
 */
function applyCancellation(
  series: RecurringSeries,
  cancelledAt: string,
  groups: Map<string, Occurrence[]>,
  today: string
): void {
  series.cancelledAt = cancelledAt;
  const direction = series.direction === "expense" ? "out" : "in";
  const occ = groups.get(`${series.merchantKey}|${direction}`) ?? [];
  const suffix = series.key.slice(`${series.merchantKey}|${direction}`.length);
  const center = suffix.startsWith("@") ? Number(suffix.slice(1)) : null;
  const after = occ.find(
    (x) => x.day > cancelledAt && x.day <= today && (center === null || Math.abs(x.amount - center) <= Math.max(2, 0.2 * center))
  );
  series.status = after ? "charged_after_cancel" : "cancelled";
  series.chargedAfterCancel = after ? { date: after.day, amount: round2(after.amount) } : null;
  series.change = null;
}

/** Drops small side charges (a few shekels next to a ₪900 bill) that break the rhythm. */
function withoutSideCharges(occ: Occurrence[]): Occurrence[] {
  if (occ.length < 4) return occ;
  const m = median(occ.map((o) => o.amount));
  return occ.filter((o) => o.amount >= 0.15 * m);
}

function clusterByAmount(occ: Occurrence[]): Occurrence[][] {
  const sorted = [...occ].sort((a, b) => a.amount - b.amount);
  const clusters: Occurrence[][] = [];
  for (const o of sorted) {
    const last = clusters[clusters.length - 1];
    const center = last ? median(last.map((x) => x.amount)) : 0;
    if (last && Math.abs(o.amount - center) <= Math.max(2, 0.12 * center)) last.push(o);
    else clusters.push([o]);
  }
  return clusters
    .filter((c) => c.length >= 2)
    .map((c) => c.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)));
}

/**
 * Reads one merchant's charges as a series. With `forced` (the user set the
 * frequency, or tracks it by hand) the rhythm and minimum-count checks are
 * skipped and the series never "ends".
 */
function evaluate(
  merchantKey: string,
  direction: "out" | "in",
  occAll: Occurrence[],
  clustered: boolean,
  { today, historyStart }: DetectOptions,
  forced?: CadenceSpec,
  forcedSuffix?: string
): RecurringSeries | null {
  // Charges within three days of each other are one occurrence (a retry or
  // a split charge), so they don't break the rhythm.
  const occ: Occurrence[] = [];
  for (const o of occAll) {
    const prev = occ[occ.length - 1];
    if (prev && daysBetween(prev.day, o.day) <= 3) {
      prev.amount += o.amount;
      prev.row = o.row;
    } else occ.push({ ...o });
  }
  if (occ.length < (forced ? 1 : 2)) return null;

  const gaps = occ.slice(1).map((o, i) => daysBetween(occ[i].day, o.day));
  const recentGap = median(gaps.slice(-8));
  const spec = forced ?? CADENCES.find((c) => Math.abs(recentGap - c.days) <= c.tol);
  if (!spec) return null;

  // The latest unbroken run, allowing one skipped charge and one irregular
  // gap (bills that move a few weeks once, then settle).
  let start = occ.length - 1;
  let skips = 0;
  let loose = 0;
  if (forced) start = Math.max(0, occ.length - 24);
  while (!forced && start > 0) {
    const gap = daysBetween(occ[start - 1].day, occ[start].day);
    if (Math.abs(gap - spec.days) <= spec.tol) start--;
    else if (skips === 0 && Math.abs(gap - 2 * spec.days) <= spec.tol * 1.5) {
      skips++;
      start--;
    } else if (loose === 0 && gap >= spec.days * 0.6 && gap <= spec.days * 1.5) {
      loose++;
      start--;
    } else break;
  }
  const run = occ.slice(start);
  const amounts = run.map((o) => o.amount);
  const last = run[run.length - 1];
  const category = last.row.categoryName;

  const recentAmounts = amounts.slice(-6);
  const typicalAll = median(recentAmounts);
  const spread = typicalAll > 0 ? (quantile(recentAmounts, 0.9) - quantile(recentAmounts, 0.1)) / typicalAll : 0;
  const change = detectChange(run);
  // A price step is not "variable": judge the spread after the step.
  const variable = change === null && spread > 0.15;

  const firstSeen = occAll[0].day;
  const isNewMerchant = daysBetween(historyStart, firstSeen) > 45;
  const exactPair =
    run.length === 2 && spec.cadence === "monthly" && sameAmount(amounts[0], amounts[1]);
  const enough = forced || run.length >= spec.minCount || (exactPair && isNewMerchant);
  if (!enough) return null;
  const everyday = category !== null && EVERYDAY_CATEGORIES.has(category);
  if (forced) {
    // The user vouched for it; no shape checks.
  } else if (variable) {
    if (clustered || run.length < 4) return null;
    if (spec.cadence === "weekly" || spec.cadence === "annual") return null;
    // Everyday spending that varies counts only when it is very regular
    // (a monthly toll or parking bill), never ordinary shopping.
    if (everyday && (run.length < 6 || loose + skips > 0)) return null;
  } else if (everyday && spread > 0.05 && run.length < 6) return null;

  const nextExpected = spec.next(last.day);
  const overdue = daysBetween(nextExpected, today);
  if (!forced && overdue > spec.days + spec.grace) return null; // ended
  const missing = overdue > spec.grace;

  const typical = change ? change.to : typicalAll;
  const status: RecurringSeries["status"] = missing
    ? "missing"
    : change && daysBetween(change.since, today) <= 120
      ? "changed"
      : isNewMerchant && daysBetween(run[0].day, today) <= spec.days * 2.5
        ? "new"
        : "active";

  const suffix = forcedSuffix ?? (clustered ? `@${Math.round(typicalAll)}` : "");
  return {
    key: `${merchantKey}|${direction}${suffix}`,
    merchant: last.row.description,
    merchantKey,
    direction: direction === "out" ? "expense" : "income",
    cadence: spec.cadence,
    variable,
    typical: round2(typical),
    min: round2(Math.min(...recentAmounts)),
    max: round2(Math.max(...recentAmounts)),
    last: round2(last.amount),
    lastDate: last.day,
    firstDate: run[0].day,
    nextExpected,
    occurrences: run.length,
    annual: round2(typical * spec.perYear),
    categoryId: last.row.categoryId,
    categoryName: category,
    categoryColor: last.row.categoryColor,
    essential: category !== null && ESSENTIAL_CATEGORIES.has(category),
    counted: last.row.counted,
    status,
    change: change && status === "changed" ? change : null,
    userCadence: false,
    manual: false,
    cancelledAt: null,
    chargedAfterCancel: null,
  };
}

/**
 * A single step to a new stable price: at least two charges at the old
 * price, then every charge since at the new one.
 */
function detectChange(run: Occurrence[]): { from: number; to: number; since: string } | null {
  if (run.length < 3) return null;
  const a = run.map((o) => o.amount);
  const n = a.length;
  let s = -1;
  for (let i = n - 1; i >= 1; i--) {
    if (priceStep(a[i - 1], a[i])) {
      s = i;
      break;
    }
  }
  if (s < 2) return null;
  const after = a.slice(s);
  if (!after.every((x) => sameAmount(x, a[n - 1]))) return null;
  // One charge at a wildly different amount is a different charge, not a new price.
  const ratio = a[n - 1] / a[s - 1];
  if (after.length === 1 && (ratio > 1.6 || ratio < 0.6)) return null;
  const before = a.slice(Math.max(0, s - 3), s);
  if (!before.every((x) => sameAmount(x, before[before.length - 1]))) return null;
  return { from: round2(median(before)), to: round2(a[n - 1]), since: run[s].day };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
