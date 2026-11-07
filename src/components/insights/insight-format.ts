import type { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { formatCurrency } from "@/lib/formatters";
import { translateCategoryName } from "@/lib/i18n-data";
import type { Insight, RecurringCadence } from "@/lib/insights-types";
import { bcpFor, formatWhole, parseLocalDate } from "@/components/home/home-format";

export type InsightsT = ReturnType<typeof useTranslations<"insights">>;
export type CategoryT = ReturnType<typeof useTranslations<"categoriesSeeded">>;

/** Whole shekels from ₪1,000 up; agorot below, unless they're zero. */
export function money(n: number, locale: Locale): string {
  if (Math.abs(n) >= 1000) return formatWhole(n, locale);
  const s = formatCurrency(n, "ILS", locale);
  return s.replace(/[.,]00$/, "");
}

/** "12 Nov", with the year when it isn't this year. */
export function day(iso: string, locale: Locale, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = parseLocalDate(iso);
  const withYear = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(bcpFor(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    ...opts,
  });
}

export function monthYear(iso: string, locale: Locale): string {
  return parseLocalDate(iso).toLocaleDateString(bcpFor(locale), { month: "long", year: "numeric" });
}

export function cadenceLabel(c: RecurringCadence | string, t: InsightsT): string {
  return t(`cadence.${c}` as "cadence.monthly");
}

/** Keeps a name in its own direction inside a sentence of the other language. */
export function isolate(s: string): string {
  return "⁨" + s + "⁩";
}

function str(v: string | number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function num(v: string | number | null | undefined): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/** Title and one-line explanation for a feed item, with the real numbers in it. */
export function insightText(
  insight: Insight,
  t: InsightsT,
  tCat: CategoryT,
  locale: Locale
): { title: string; detail: string } {
  const p = insight.params;
  const m = (k: string) => money(num(p[k]), locale);
  const d = (k: string) => day(str(p[k]), locale);
  const cat = (k: string) => isolate(translateCategoryName(str(p[k]), tCat));
  const merchant = isolate(str(p.merchant));
  switch (insight.type) {
    case "price_up":
      return {
        title: t("feed.price_up.title", { merchant }),
        detail: t("feed.price_up.detail", { from: m("from"), to: m("to"), since: d("since"), yearly: m("yearly") }),
      };
    case "price_down":
      return {
        title: t("feed.price_down.title", { merchant }),
        detail: t("feed.price_down.detail", { from: m("from"), to: m("to"), since: d("since"), yearly: m("yearly") }),
      };
    case "new_recurring":
      return {
        title: t("feed.new_recurring.title", { merchant }),
        detail: t("feed.new_recurring.detail", {
          amount: m("amount"),
          cadence: cadenceLabel(str(p.cadence), t),
          since: d("since"),
          yearly: m("yearly"),
        }),
      };
    case "missing_recurring":
      return {
        title: t("feed.missing_recurring.title", { merchant }),
        detail: t("feed.missing_recurring.detail", {
          amount: m("amount"),
          cadence: cadenceLabel(str(p.cadence), t),
          expected: d("expected"),
        }),
      };
    case "duplicate":
      return {
        title: t("feed.duplicate.title", { merchant }),
        detail: t("feed.duplicate.detail", { amount: m("amount"), first: d("first"), second: d("second") }),
      };
    case "forecast_over": {
      const source = str(p.source) || "target";
      return {
        title: t(`feed.forecast_over.title_${source}` as "feed.forecast_over.title_target"),
        detail: t(`feed.forecast_over.detail_${source}` as "feed.forecast_over.detail_target", {
          low: m("low"),
          high: m("high"),
          target: m("target"),
          end: d("end"),
        }),
      };
    }
    case "forecast_under":
      return {
        title: t("feed.forecast_under.title"),
        detail: t("feed.forecast_under.detail", { low: m("low"), high: m("high"), target: m("target"), end: d("end") }),
      };
    case "budget_pace":
      return num(p.over) === 1
        ? {
            title: t("feed.budget_pace.title_over", { category: cat("category") }),
            detail: t("feed.budget_pace.detail_over", { spent: m("spent"), budget: m("budget") }),
          }
        : {
            title: t("feed.budget_pace.title_pace", { category: cat("category") }),
            detail: t("feed.budget_pace.detail_pace", { spent: m("spent"), projected: m("projected"), budget: m("budget") }),
          };
    case "unusual_category":
      return {
        title: t("feed.unusual_category.title", { category: cat("category") }),
        detail: t("feed.unusual_category.detail", { amount: m("amount"), typical: m("typical") }),
      };
    case "large_charge":
      return {
        title:
          num(p.firstTime) === 1
            ? t("feed.large_charge.title_new", { merchant })
            : t("feed.large_charge.title", { merchant }),
        detail: p.category
          ? t("feed.large_charge.detail", { amount: m("amount"), date: d("date"), category: cat("category") })
          : t("feed.large_charge.detail_plain", { amount: m("amount"), date: d("date") }),
      };
    case "salary_late":
      return {
        title: t("feed.salary_late.title"),
        detail: t("feed.salary_late.detail", { merchant, day: num(p.day), typical: m("typical") }),
      };
    case "salary_changed": {
      const change = num(p.change);
      return {
        title: t(change > 0 ? "feed.salary_changed.title_up" : "feed.salary_changed.title_down", {
          pct: Math.round(Math.abs(change) * 100),
        }),
        detail: t("feed.salary_changed.detail", { last: m("last"), typical: m("typical") }),
      };
    }
    case "installments_ending":
      return {
        title: t("feed.installments_ending.title", { count: num(p.count) }),
        detail: t("feed.installments_ending.detail", { freed: m("freed"), from: d("from") }),
      };
    case "fees":
      return {
        title: t("feed.fees.title", { total: m("total") }),
        detail: t("feed.fees.detail", { lines: num(p.lines) }),
      };
    case "budget_suggest":
      return {
        title: t("feed.budget_suggest.title"),
        detail: t("feed.budget_suggest.detail", { count: num(p.count) }),
      };
    case "refund":
      return {
        title: t("feed.refund.title", { merchant }),
        detail: t("feed.refund.detail", { amount: m("amount"), date: d("date") }),
      };
    case "charged_after_cancel":
      return {
        title: t("feed.charged_after_cancel.title", { merchant }),
        detail: t("feed.charged_after_cancel.detail", { amount: m("amount"), date: d("date"), cancelledAt: d("cancelledAt") }),
      };
    case "merchant_merge":
      return {
        title: t("feed.merchant_merge.title"),
        detail: t("feed.merchant_merge.detail", { a: isolate(str(p.a)), b: isolate(str(p.b)) }),
      };
  }
}
