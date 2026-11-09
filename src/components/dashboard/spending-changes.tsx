"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartTooltip, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { formatWhole } from "@/components/home/home-format";
import { translateCategoryName } from "@/lib/i18n-data";
import { formatRangeLabel, parseISODay } from "@/lib/period";
import { BudgetDetailSheet } from "./budget-detail-sheet";
import type { CategoryChanges } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

const MAX_ROWS = 6;
/** Changes smaller than this share of the larger side read as "about the same". */
const STEADY_SHARE = 0.03;

interface SpendingChangesProps {
  changes: CategoryChanges | undefined;
  loading: boolean;
  from: string;
  to: string;
}

interface Row {
  categoryId: number;
  name: string;
  color: string;
  current: number;
  previous: number;
  delta: number;
}

function isSteady(current: number, previous: number): boolean {
  const base = Math.max(current, previous);
  return base <= 0 || Math.abs(current - previous) / base < STEADY_SHARE;
}

export function SpendingChanges({ changes, loading, from, to }: SpendingChangesProps) {
  const t = useTranslations("dashboard");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const { containerRef, tip, show, hide } = useChartTip();

  const { rows, rest, nowTotal, thenTotal, scale } = useMemo(() => {
    const all: Row[] = (changes?.rows ?? [])
      .map((r) => ({
        ...r,
        name: translateCategoryName(r.name, tCat),
        delta: r.current - r.previous,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const shown = all.slice(0, MAX_ROWS);
    return {
      rows: shown,
      rest: all.length - shown.length,
      nowTotal: all.reduce((s, r) => s + r.current, 0),
      thenTotal: all.reduce((s, r) => s + r.previous, 0),
      scale: Math.max(1, ...shown.flatMap((r) => [r.current, r.previous])),
    };
  }, [changes, tCat]);

  const range = useMemo(() => {
    const start = changes ? parseISODay(changes.previousFrom) : null;
    const end = changes ? parseISODay(changes.previousTo) : null;
    return start && end ? formatRangeLabel(start, end, locale) : "";
  }, [changes, locale]);

  const totalDelta = nowTotal - thenTotal;
  const totalSteady = isSteady(nowTotal, thenTotal);
  const hasHistory = thenTotal > 0;

  const signed = (delta: number) =>
    `${delta >= 0 ? "+" : "−"}${formatWhole(delta, locale)}`;

  return (
    <section className="flex flex-col rounded-3xl border border-border bg-card p-5 sm:p-6 md:p-8">
      <div className="mb-6">
        <h2 className="font-serif text-2xl">{t("changesTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading || !range
            ? t("changesSubtitleLoading")
            : changes?.sameDays
              ? t("changesSubtitleSameDays", { range })
              : t("changesSubtitleFull", { range })}
        </p>
      </div>

      {loading ? (
        <div className="space-y-5">
          <Skeleton className="h-12 w-2/3 rounded-lg" />
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : !hasHistory || rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-6 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">{t("changesEmpty")}</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <div
                className={`flex items-center gap-1.5 font-sans text-[1.75rem] leading-tight font-semibold tracking-tight tabular-nums ${
                  totalSteady
                    ? ""
                    : totalDelta > 0
                      ? "text-[var(--status-over)]"
                      : "text-[var(--status-on-track)]"
                }`}
              >
                {totalSteady ? (
                  t("changesSteady")
                ) : (
                  <>
                    {totalDelta > 0 ? (
                      <ArrowUpRight className="size-6 shrink-0" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="size-6 shrink-0" aria-hidden="true" />
                    )}
                    {totalDelta > 0
                      ? t("changesMore", { amount: formatWhole(totalDelta, locale) })
                      : t("changesLess", { amount: formatWhole(totalDelta, locale) })}
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {t("changesTotals", {
                  now: formatWhole(nowTotal, locale),
                  then: formatWhole(thenTotal, locale),
                })}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border-2 border-muted-foreground/70 bg-card" />
                {t("changesThen")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-foreground/80" />
                {t("changesNow")}
              </span>
            </div>
          </div>

          <div ref={containerRef} className="relative" onMouseLeave={() => { setActiveId(null); hide(); }}>
            <ul className="space-y-1">
              {rows.map((r) => {
                const steady = isSteady(r.current, r.previous);
                const isNew = r.previous <= 0;
                const thenPct = (r.previous / scale) * 100;
                const nowPct = (r.current / scale) * 100;
                const lo = Math.min(thenPct, nowPct);
                const hi = Math.max(thenPct, nowPct);
                const lit = activeId == null || activeId === r.categoryId;
                const tipContent = (
                  <TipBody
                    title={r.name}
                    rows={[
                      [t("changesThen"), formatWhole(r.previous, locale)],
                      [t("changesNow"), formatWhole(r.current, locale)],
                      [t("changesChange"), isNew ? t("changesNew") : signed(r.delta)],
                    ]}
                  />
                );
                return (
                  <li key={r.categoryId}>
                    <button
                      type="button"
                      aria-label={t("changesRowAria", {
                        name: r.name,
                        then: formatWhole(r.previous, locale),
                        now: formatWhole(r.current, locale),
                      })}
                      onMouseEnter={(e) => {
                        setActiveId(r.categoryId);
                        show(e.currentTarget.querySelector("[data-track]") ?? e.currentTarget, tipContent);
                      }}
                      onFocus={(e) => {
                        setActiveId(r.categoryId);
                        show(e.currentTarget.querySelector("[data-track]") ?? e.currentTarget, tipContent);
                      }}
                      onBlur={() => {
                        setActiveId(null);
                        hide();
                      }}
                      onClick={() => setSelectedId(r.categoryId)}
                      className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-start transition-[opacity,background-color] duration-200 motion-reduce:transition-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        lit ? "opacity-100" : "opacity-45"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                        <span
                          className={`shrink-0 text-end font-sans text-sm font-semibold tabular-nums ${
                            steady || isNew
                              ? "text-muted-foreground"
                              : r.delta > 0
                                ? "text-[var(--status-over)]"
                                : "text-[var(--status-on-track)]"
                          }`}
                        >
                          {isNew ? t("changesNew") : <bdi dir="ltr">{signed(r.delta)}</bdi>}
                        </span>
                      </div>
                      {/* Dumbbell: hollow dot last period, filled dot now, joined by the gap. */}
                      <div className="relative mt-2.5 h-3 px-1.5" data-track>
                        <div className="absolute inset-x-1.5 top-1/2 h-px -translate-y-1/2 bg-muted" />
                        <div className="relative h-full">
                          <div
                            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full transition-[inset-inline-start,width] duration-500 ease-out motion-reduce:transition-none"
                            style={{
                              insetInlineStart: `${lo}%`,
                              width: `${hi - lo}%`,
                              background: `color-mix(in oklch, ${r.color} 55%, transparent)`,
                            }}
                          />
                          {!isNew && (
                            <span
                              className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 bg-card ltr:-translate-x-1/2 rtl:translate-x-1/2"
                              style={{
                                insetInlineStart: `${thenPct}%`,
                                borderColor: `color-mix(in oklch, ${r.color} 70%, var(--muted-foreground))`,
                              }}
                            />
                          )}
                          <span
                            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full ring-2 ring-card ltr:-translate-x-1/2 rtl:translate-x-1/2"
                            style={{ insetInlineStart: `${nowPct}%`, background: r.color }}
                          />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <ChartTooltip tip={tip} />
          </div>

          {rest > 0 && (
            <p className="mt-auto px-3 pt-4 text-xs text-muted-foreground">
              {t("changesRest", { count: rest })}
            </p>
          )}
        </div>
      )}

      <BudgetDetailSheet
        categoryId={selectedId}
        from={from}
        to={to}
        onClose={() => setSelectedId(null)}
      />
    </section>
  );
}
