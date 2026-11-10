import "server-only";

import type { InsightRow } from "./data";
import type {
  CommittedPeriod,
  RecurringSeries,
  UpcomingCharge,
} from "@/lib/insights-types";
import { BANK_PROVIDERS } from "@/lib/types";
import { type Period, shiftPeriod, toISODay } from "@/lib/period";
import { addDays, addMonths, daysBetween } from "./math";
import { normalizeMerchant } from "./merchant";

/** A purchase still being paid in monthly installments. */
export interface ActivePlan {
  merchant: string;
  perPayment: number;
  total: number;
  paid: number;
  /** Future payments: transaction day (for periods) and charge day (for the calendar). */
  payments: Array<{ day: string; chargeDay: string; number: number }>;
  endsOn: string;
}

/**
 * Installment rows of one purchase share card, merchant, full purchase amount
 * and plan length (see getInstallmentPlan in queries/transactions.ts).
 */
export function activePlans(rows: InsightRow[]): ActivePlan[] {
  const groups = new Map<string, InsightRow[]>();
  const refunds = rows.filter((r) => r.isInstallment && r.amount > 0);
  for (const r of rows) {
    if (!r.isInstallment || !r.installmentTotal || r.installmentTotal < 2 || r.amount >= 0) continue;
    const key = [r.credentialId, r.accountNumber, r.description, r.originalAmount, r.installmentTotal].join("|");
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const plans: ActivePlan[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => (a.chargeDay < b.chargeDay ? -1 : 1));
    const total = g[0].installmentTotal as number;
    const paid = Math.max(g.length, ...g.map((r) => r.installmentNumber ?? 0));
    if (paid >= total) continue;
    if (refundOf(g[0], refunds)) continue;
    const last = g[g.length - 1];
    const payments = [];
    for (let k = 1; k <= total - paid; k++) {
      payments.push({ day: addMonths(last.day, k), chargeDay: addMonths(last.chargeDay, k), number: paid + k });
    }
    plans.push({
      merchant: last.description,
      perPayment: Math.abs(last.amount),
      total,
      paid,
      payments,
      endsOn: payments[payments.length - 1].chargeDay,
    });
  }
  return plans;
}

/**
 * The card's credit for a returned installment purchase: same card and plan
 * length, the purchase amount with the opposite sign, and the merchant name
 * with a prefix such as "תיקון" (correction). The credits mirror the
 * payments, so nothing more is owed.
 */
export function refundOf(purchase: InsightRow, refunds: InsightRow[]): InsightRow | null {
  const key = normalizeMerchant(purchase.description);
  return (
    refunds.find(
      (r) =>
        r.credentialId === purchase.credentialId &&
        r.accountNumber === purchase.accountNumber &&
        r.originalAmount === -purchase.originalAmount &&
        (r.installmentTotal === null || r.installmentTotal === purchase.installmentTotal) &&
        (() => {
          const k = normalizeMerchant(r.description);
          return k.includes(key) || key.includes(k);
        })()
    ) ?? null
  );
}

const STEP_DAYS: Record<RecurringSeries["cadence"], number> = {
  weekly: 7,
  monthly: 0,
  bimonthly: 0,
  quarterly: 0,
  annual: 0,
};
const STEP_MONTHS: Record<RecurringSeries["cadence"], number> = {
  weekly: 0,
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  annual: 12,
};

/** Expected charge days of a series from its next one through `until`. */
export function projectSeries(s: RecurringSeries, until: string): string[] {
  const out: string[] = [];
  let d = s.nextExpected;
  for (let i = 0; i < 400 && d <= until; i++) {
    out.push(d);
    d = STEP_DAYS[s.cadence] ? addDays(d, STEP_DAYS[s.cadence]) : addMonths(d, STEP_MONTHS[s.cadence]);
  }
  return out;
}

/** Still expected: not missing, and not canceled by the user. */
export function isExpected(s: RecurringSeries): boolean {
  return s.status !== "missing" && s.status !== "cancelled" && s.status !== "charged_after_cancel";
}

/** Spending that counts and isn't income: what commitments are made of. */
function committedSeries(series: RecurringSeries[]): RecurringSeries[] {
  return series.filter((s) => s.direction === "expense" && s.counted && isExpected(s));
}

/**
 * What's still to pay in the current period (after today), then the next
 * `count` periods: installments already agreed to plus recurring charges.
 */
export function committedPeriods(
  current: Period,
  startDay: number,
  plans: ActivePlan[],
  series: RecurringSeries[],
  today: string,
  count = 5
): CommittedPeriod[] {
  const out: CommittedPeriod[] = [];
  const recurring = committedSeries(series);
  for (let i = 0; i <= count; i++) {
    const p = shiftPeriod(current, i, startDay);
    const periodStart = toISODay(p.start);
    // Already paid this period is spending, not a commitment.
    const from = i === 0 ? addDays(today, 1) : periodStart;
    const to = toISODay(p.end);
    let installments = 0;
    const planRows: CommittedPeriod["plans"] = [];
    for (const plan of plans) {
      const due = plan.payments.filter((x) => x.day >= from && x.day <= to);
      if (due.length === 0) continue;
      const amount = plan.perPayment * due.length;
      installments += amount;
      const lastDue = due[due.length - 1].number;
      planRows.push({ merchant: plan.merchant, amount: round2(amount), remaining: plan.total - lastDue, endsOn: plan.endsOn });
    }
    let rec = 0;
    const items: CommittedPeriod["items"] = [];
    for (const s of recurring) {
      for (const d of projectSeries(s, to).filter((x) => x >= from)) {
        rec += s.typical;
        items.push({ merchant: s.merchant, amount: s.typical, date: d, variable: s.variable });
      }
    }
    out.push({
      periodStart,
      periodEnd: to,
      current: i === 0,
      installments: round2(installments),
      recurring: round2(rec),
      plans: planRows.sort((a, b) => b.amount - a.amount),
      items: items.sort((a, b) => b.amount - a.amount),
    });
  }
  return out;
}

const CARD_PROVIDERS = new Set(BANK_PROVIDERS.filter((b) => b.kind === "card").map((b) => b.id as string));

/**
 * The next `days` days: recurring charges and income, installment payments,
 * and card bills already building up (card purchases with a future charge day).
 */
export function upcomingCharges(
  today: string,
  rows: InsightRow[],
  plans: ActivePlan[],
  series: RecurringSeries[],
  cardLabels: Map<number, string>,
  days = 30
): UpcomingCharge[] {
  const until = addDays(today, days);
  const out: UpcomingCharge[] = [];
  for (const s of series) {
    if (!isExpected(s) || (!s.counted && s.direction === "expense")) continue;
    for (const d of projectSeries(s, until)) {
      if (d <= today) continue;
      out.push({
        date: d,
        merchant: s.merchant,
        amount: s.typical,
        kind: s.direction === "income" ? "income" : "recurring",
        estimated: s.variable,
        seriesKey: s.key,
      });
    }
  }
  for (const plan of plans) {
    for (const p of plan.payments) {
      if (p.chargeDay > today && p.chargeDay <= until) {
        out.push({ date: p.chargeDay, merchant: plan.merchant, amount: plan.perPayment, kind: "installment", estimated: true });
      }
    }
  }
  const bills = new Map<string, { date: string; credentialId: number; amount: number }>();
  for (const r of rows) {
    if (r.credentialId === null || !CARD_PROVIDERS.has(r.provider)) continue;
    if (r.chargeDay <= today || r.chargeDay > until || daysBetween(r.day, r.chargeDay) < 0) continue;
    const key = `${r.credentialId}|${r.chargeDay}`;
    const b = bills.get(key) ?? { date: r.chargeDay, credentialId: r.credentialId, amount: 0 };
    b.amount -= r.amount;
    bills.set(key, b);
  }
  for (const b of bills.values()) {
    if (b.amount <= 0) continue;
    out.push({
      date: b.date,
      merchant: cardLabels.get(b.credentialId) ?? "",
      amount: round2(b.amount),
      kind: "card_bill",
      // Purchases keep arriving until the statement closes.
      estimated: true,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
