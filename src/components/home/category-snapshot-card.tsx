"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { translateCategoryName } from "@/lib/i18n-data";
import type { Locale } from "@/i18n/routing";
import type { HomeCategorySnapshotItem } from "@/lib/types";
import { CardShell, CardAction } from "./card-shell";
import { categoryIconFor } from "./category-icon";
import { AMBER_INK, formatWhole, tintFor } from "./home-format";

interface Props {
  items: HomeCategorySnapshotItem[];
  /** All counted spending this period, so the stacked bar shows true shares. */
  totalSpent: number | null;
  /** Share of the period that has passed, 0 to 100. */
  elapsedPercent: number | null;
}

// Points of budget used beyond the calendar before a category reads as ahead.
const OVER_PACE_POINTS = 10;

export function CategorySnapshotCard({ items, totalSpent, elapsedPercent }: Props) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;

  if (items.length === 0) {
    return (
      <CardShell label={t("whereItWent")}>
        <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
          {t("topCategoriesEmpty")}
        </div>
      </CardShell>
    );
  }

  const shown = items.reduce((s, i) => s + i.spent, 0);
  const total = Math.max(totalSpent ?? 0, shown);
  const rest = total - shown;

  return (
    <CardShell
      label={t("whereItWent")}
      action={<CardAction href="/budget">{t("allCategories")}</CardAction>}
    >
      <div className="mb-4 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {items.map((item) => (
          <i
            key={item.categoryId}
            className="block min-w-1"
            style={{ flexGrow: item.spent, backgroundColor: item.color }}
          />
        ))}
        {rest > total * 0.005 && (
          <i className="block min-w-1 bg-muted" style={{ flexGrow: rest }} />
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <Row
            key={item.categoryId}
            item={item}
            name={translateCategoryName(item.name, tCat)}
            total={total}
            elapsedPercent={elapsedPercent}
            locale={locale}
          />
        ))}
      </ul>
    </CardShell>
  );
}

function Row({
  item,
  name,
  total,
  elapsedPercent,
  locale,
}: {
  item: HomeCategorySnapshotItem;
  name: string;
  total: number;
  elapsedPercent: number | null;
  locale: Locale;
}) {
  const t = useTranslations("home");
  const Icon = categoryIconFor(item.icon);
  const hasBudget = item.budget > 0;
  const share = total > 0 ? (item.spent / total) * 100 : 0;
  const overPace =
    hasBudget &&
    (item.percentSpent > 100 ||
      (elapsedPercent != null && item.percentSpent - elapsedPercent >= OVER_PACE_POINTS));
  const fill = Math.min(100, hasBudget ? item.percentSpent : share);

  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[30px_minmax(0,1fr)_minmax(70px,34%)_auto]">
      <span
        className="row-span-2 grid size-[30px] place-items-center rounded-[9px] sm:row-span-1"
        style={{ backgroundColor: tintFor(item.color) }}
        aria-hidden
      >
        <Icon className="size-[15px] text-foreground/80" />
      </span>

      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium">{name}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {t("purchases", { count: item.count })}
          {item.topMerchant && item.count > 1 && (
            <>
              {" · "}
              {t("mostly")} <bdi>{item.topMerchant}</bdi>
            </>
          )}
        </div>
      </div>

      <div
        className="relative col-start-2 col-end-4 row-start-2 h-1.5 overflow-hidden rounded-full bg-muted sm:col-start-3 sm:col-end-4 sm:row-start-1"
        role="img"
        aria-label={
          hasBudget
            ? t("categoryMeterBudget", { percent: Math.round(item.percentSpent) })
            : t("categoryMeterShare", { percent: Math.round(share) })
        }
      >
        <i
          className={cn(
            "absolute inset-y-0 start-0 block rounded-full",
            overPace && "bg-status-heads-up"
          )}
          style={{
            width: `${Math.max(fill, 2)}%`,
            backgroundColor: overPace ? undefined : item.color,
          }}
        />
        {hasBudget && elapsedPercent != null && (
          <span
            className="absolute inset-y-0 w-0.5 bg-foreground opacity-35"
            style={{ insetInlineStart: `${Math.min(100, elapsedPercent)}%` }}
          />
        )}
      </div>

      <div
        className={cn(
          "col-start-3 row-start-1 min-w-16 text-end text-[13.5px] font-medium tabular-nums sm:col-start-4",
          overPace && AMBER_INK
        )}
      >
        {formatWhole(item.spent, locale)}
        <small className="block text-[11px] font-normal text-muted-foreground">
          {hasBudget
            ? t("ofAmount", { amount: formatWhole(item.budget, locale) })
            : t("shareOfSpending", { percent: Math.round(share) })}
        </small>
      </div>
    </li>
  );
}
