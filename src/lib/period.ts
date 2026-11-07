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

/** `count` whole periods ending with `last`, as one span. */
export function periodsEndingWith(last: Period, count: number, startDay: number): Period {
  const first = shiftPeriod(last, -(Math.max(1, count) - 1), startDay);
  return { start: first.start, end: last.end };
}

/** Parses a "YYYY-MM-DD" day as local midnight, or null when malformed. */
export function parseISODay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Label for any span of days: "Sep – Nov 2026" when it covers whole calendar
 * months, otherwise "10 Sep – 9 Dec" (years added when they differ from the
 * current one or from each other).
 */
export function formatRangeLabel(start: Date, end: Date, locale?: Locale): string {
  const bcp = bcp47(locale);
  const dayAfterEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (start.getDate() === 1 && dayAfterEnd.getDate() === 1) {
    if (sameYear && start.getMonth() === end.getMonth()) {
      return start.toLocaleDateString(bcp, { month: "long", year: "numeric" });
    }
    const from = start.toLocaleDateString(bcp, sameYear ? { month: "short" } : { month: "short", year: "numeric" });
    return `${from} – ${end.toLocaleDateString(bcp, { month: "short", year: "numeric" })}`;
  }
  const showYear = !sameYear || end.getFullYear() !== new Date().getFullYear();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const fmt = (d: Date) => d.toLocaleDateString(bcp, showYear ? { ...opts, year: "numeric" } : opts);
  return start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}
