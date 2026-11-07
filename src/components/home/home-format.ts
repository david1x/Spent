import type { Locale } from "@/i18n/routing";
import { AMOUNT_MASK, amountsHidden } from "@/lib/privacy";

export function bcpFor(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-IL";
}

/** Whole shekels for headline figures, e.g. "₪4,782". */
export function formatWhole(amount: number, locale: Locale): string {
  return `₪${formatNumberWhole(amount, locale)}`;
}

export function formatNumberWhole(amount: number, locale: Locale): string {
  if (amountsHidden()) return AMOUNT_MASK;
  return Math.round(Math.abs(amount)).toLocaleString(bcpFor(locale), {
    maximumFractionDigits: 0,
  });
}

/** Compact axis and bar labels: 13200 becomes "13.2k", 850 stays "850". */
export function formatK(value: number): string {
  if (amountsHidden()) return "•••";
  if (Math.abs(value) < 1000) return String(Math.round(value));
  const k = value / 1000;
  const digits = Math.abs(k) >= 100 ? 0 : 1;
  return `${k.toFixed(digits).replace(/\.0$/, "")}k`;
}

/** Parses a plain YYYY-MM-DD (or YYYY-MM) key as a local date, not UTC. */
export function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatMonthName(
  key: string,
  locale: Locale,
  style: "long" | "short" = "long"
): string {
  return parseLocalDate(key).toLocaleDateString(bcpFor(locale), { month: style });
}

/** Amber text that stays readable on cards in both themes. */
export const AMBER_INK =
  "text-[color-mix(in_oklch,var(--status-heads-up)_55%,var(--foreground))]";
export const AMBER_SOFT_BG =
  "bg-[color-mix(in_oklch,var(--status-heads-up)_18%,var(--card))]";

/** Tinted tile behind a category icon. */
export function tintFor(color: string | null | undefined, percent = 30): string {
  if (!color) return "var(--muted)";
  return `color-mix(in oklch, ${color} ${percent}%, var(--card))`;
}
