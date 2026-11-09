"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BudgetDetailSheet } from "@/components/dashboard/budget-detail-sheet";
import { ChartTooltip, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { cn } from "@/lib/utils";
import { translateCategoryName } from "@/lib/i18n-data";
import type { Locale } from "@/i18n/routing";
import type { HomeCategorySnapshotItem } from "@/lib/types";
import { CardShell, CardAction } from "./card-shell";
import { categoryIconFor } from "./category-icon";
import { AMBER_INK, formatWhole, tintFor } from "./home-format";
import { BudgetEditPopover } from "@/components/budget/budget-edit-popover";

interface Props {
  items: HomeCategorySnapshotItem[];
  /** All counted spending this period, so the stacked bar shows true shares. */
  totalSpent: number | null;
  /** Share of the period that has passed, 0 to 100. */
  elapsedPercent: number | null;
  /** The current period, for the category sheet. */
  period: { from: string; to: string } | null;
}

// Points of budget used beyond the calendar before a category reads as ahead.
const OVER_PACE_POINTS = 10;

export function CategorySnapshotCard({ items, totalSpent, elapsedPercent, period }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("charts");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const [openId, setOpenId] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();

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
      <div ref={containerRef} className="relative mb-4" onMouseLeave={() => { setHovered(null); hide(); }}>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {items.map((item) => {
            const name = translateCategoryName(item.name, tCat);
            const share = total > 0 ? Math.round((item.spent / total) * 100) : 0;
            return (
              <button
                key={item.categoryId}
                type="button"
                className="block min-w-1 cursor-pointer outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring"
                style={{ flexGrow: item.spent, backgroundColor: item.color, opacity: hovered !== null && hovered !== item.categoryId ? 0.4 : 1 }}
                aria-label={`${name}: ${formatWhole(item.spent, locale)}`}
                onMouseEnter={(e) => {
                  setHovered(item.categoryId);
                  show(e.currentTarget, <TipBody title={name} rows={[[tc("spent"), formatWhole(item.spent, locale)], [tc("share"), `${share}%`]]} />);
                }}
                onFocus={(e) => show(e.currentTarget, <TipBody title={name} rows={[[tc("spent"), formatWhole(item.spent, locale)], [tc("share"), `${share}%`]]} />)}
                onBlur={hide}
                onClick={() => setOpenId(item.categoryId)}
              />
            );
          })}
          {rest > total * 0.005 && (
            <i
              className="block min-w-1 bg-muted"
              style={{ flexGrow: rest }}
              onMouseEnter={(e) => {
                setHovered(-1);
                show(e.currentTarget, <TipBody title={tc("otherCategories")} rows={[[tc("spent"), formatWhole(rest, locale)], [tc("share"), `${Math.round((rest / total) * 100)}%`]]} />);
              }}
            />
          )}
        </div>
        <ChartTooltip tip={tip} />
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
            highlighted={hovered === item.categoryId}
            onOpen={() => setOpenId(item.categoryId)}
            onHover={(on) => setHovered(on ? item.categoryId : null)}
          />
        ))}
      </ul>
      {period ? (
        <BudgetDetailSheet categoryId={openId} from={period.from} to={period.to} onClose={() => setOpenId(null)} />
      ) : null}
    </CardShell>
  );
}

function Row({
  item,
  name,
  total,
  elapsedPercent,
  locale,
  highlighted,
  onOpen,
  onHover,
}: {
  item: HomeCategorySnapshotItem;
  name: string;
  total: number;
  elapsedPercent: number | null;
  locale: Locale;
  highlighted: boolean;
  onOpen: () => void;
  onHover: (on: boolean) => void;
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
    <li
      className={cn(
        "-mx-2 grid cursor-pointer grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[30px_minmax(0,1fr)_minmax(70px,34%)_auto]",
        highlighted && "bg-muted/50"
      )}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Keys pressed on the budget button inside belong to it.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
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
        <BudgetEditPopover
          categoryId={item.categoryId}
          categoryName={name}
          amount={hasBudget ? item.budget : null}
          trigger={
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              title={t("editBudget", { name })}
              className="block w-full rounded-sm text-end text-[11px] font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {hasBudget ? t("ofAmount", { amount: formatWhole(item.budget, locale) }) : t("setBudget")}
            </button>
          }
        />
      </div>
    </li>
  );
}
