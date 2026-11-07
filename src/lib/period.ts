/**
 * Budget periods. By default a period is a calendar month. When the user
 * runs budgets "payday to payday", a period starts on their payday and ends
 * the day before the next one, so the salary opens each period instead of
 * landing a third of the way in and making the first days look overspent.
 *
 * Shared by the server routes and the client pages so both agree on ranges.
 */

import type { Locale } from "@/i18n/routing";

export type BudgetPeriodMode = "calendar" | "payday";

export interface Period {
  /** First day, local midnight. */
  start: Date;
  /** Last day, local midnight. */
  end: Date;
}

/** Day of month a period starts on: 1 for calendar months, else the payday. */
export function periodStartDay(mode: BudgetPeriodMode, paydayDay: number): number {
  if (mode !== "payday") return 1;
  return Math.max(1, Math.min(28, Math.round(paydayDay)));
}

/** The period that contains `date`. */
export function periodContaining(date: Date, startDay: number): Period {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startMonth = date.getDate() >= startDay ? m : m - 1;
  const start = new Date(y, startMonth, startDay);
  // Day before the same start day next month. startDay is capped at 28, so
  // this never spills over a short month.
  const end = new Date(y, startMonth + 1, startDay - 1);
  return { start, end };
}

/** The period `n` periods after (or before, when negative) `period`. */
export function shiftPeriod(period: Period, n: number, startDay: number): Period {
  const anchor = new Date(period.start.getFullYear(), period.start.getMonth() + n, startDay);
  return periodContaining(anchor, startDay);
}

export function toISODay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function periodRange(period: Period): { from: string; to: string } {
  return { from: toISODay(period.start), to: toISODay(period.end) };
}

export function periodLength(period: Period): number {
  return Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000) + 1;
}

/** 1-based day of `today` within the period, clamped to its bounds. */
export function dayOfPeriod(period: Period, today: Date = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t < period.start) return 0;
  if (t > period.end) return periodLength(period);
  return Math.round((t.getTime() - period.start.getTime()) / 86_400_000) + 1;
}

function bcp47(locale?: Locale): string {
  return locale === "he" ? "he-IL" : "en-IL";
}

/** "November 2026" for calendar months, "10 Oct – 9 Nov" style for pay cycles. */
export function formatPeriodLabel(period: Period, locale?: Locale): string {
  const bcp = bcp47(locale);
  if (period.start.getDate() === 1) {
    return period.start.toLocaleDateString(bcp, { month: "long", year: "numeric" });
  }
  const fmt = (d: Date) => d.toLocaleDateString(bcp, { day: "numeric", month: "short" });
  return `${fmt(period.start)} – ${fmt(period.end)}`;
}

/** Short name for the period in sentences ("this November"). Pay cycles are named by the month they start in. */
export function periodMonthName(period: Period, locale?: Locale): string {
  return period.start.toLocaleDateString(bcp47(locale), { month: "long" });
}
