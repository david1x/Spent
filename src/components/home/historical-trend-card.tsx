"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { HomeHistoricalTrendPoint } from "@/lib/types";
import { ChartTooltip, ExpandableChart, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { cn } from "@/lib/utils";
import { CardShell } from "./card-shell";
import { formatK, formatMonthName, formatWhole } from "./home-format";
import { useElementWidth } from "./use-element-width";

interface Props {
  data: HomeHistoricalTrendPoint[];
  /** Monthly budget, 0 when none is set. */
  budget: number;
  /** Projected total for the current month, null when unknown. */
  projected: number | null;
}

const HEIGHT = 210;
const EXPANDED_HEIGHT = 320;
const PAD = { left: 34, right: 6, top: 18, bottom: 26 };

function transactionsHref(d: HomeHistoricalTrendPoint): string {
  return `/transactions?from=${d.from}&to=${d.to}`;
}

export function HistoricalTrendCard({ data, budget, projected }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const hasData = data.some((d) => d.total > 0);

  const past = data.filter((d) => !d.isCurrent && d.total > 0);
  const average = past.length > 0 ? past.reduce((s, d) => s + d.total, 0) / past.length : null;
  const current = data.find((d) => d.isCurrent) ?? null;
  const forecast =
    current && projected != null && projected > current.total + 0.5 ? projected : null;
  const currentName = current ? formatMonthName(current.month, locale, "short") : "";

  return (
    <CardShell label={t("last8Months")}>
      {!hasData ? (
        <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
          {t("notEnoughHistory")}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            {average != null && (
              <span className="font-serif text-[1.625rem] leading-none tabular-nums">
                {formatWhole(average, locale)}
              </span>
            )}
            <span className="text-[12.5px] text-muted-foreground">
              {average != null && t("averageMonth")}
              {average != null && forecast != null && " · "}
              {forecast != null &&
                t("monthOnPaceFor", {
                  month: currentName,
                  amount: formatWhole(forecast, locale),
                })}
            </span>
          </div>

          <ExpandableChart
            className="mt-auto"
            title={t("last8Months")}
            description={t("trendExpandedHint")}
            expanded={<ExpandedTrend data={data} budget={budget} forecast={forecast} average={average} />}
          >
            <InteractiveChart data={data} budget={budget} forecast={forecast} average={average} height={HEIGHT} />
          </ExpandableChart>

          {(budget > 0 || forecast != null) && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
              {budget > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <i className="block w-3.5 border-t-[1.5px] border-dashed border-foreground/60" aria-hidden />
                  {t("budgetKey", { amount: formatWhole(budget, locale) })}
                </span>
              )}
              {forecast != null && current && (
                <span className="inline-flex items-center gap-1.5">
                  <i className="block size-2.5 rounded-[2px] border-[1.4px] border-dashed border-primary" aria-hidden />
                  {t("forecastKey", { month: formatMonthName(current.month, locale) })}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

/** The bar chart with hover tooltips; `onSelect` makes bars clickable. */
function InteractiveChart({
  data,
  budget,
  forecast,
  average,
  height,
  onSelect,
}: {
  data: HomeHistoricalTrendPoint[];
  budget: number;
  forecast: number | null;
  average: number | null;
  height: number;
  onSelect?: (d: HomeHistoricalTrendPoint) => void;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("charts");
  const locale = useLocale() as Locale;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const average_ = average;

  const tipFor = (d: HomeHistoricalTrendPoint) => {
    const rows: Array<[string, string]> = [[tc("spent"), formatWhole(d.total, locale)]];
    if (average_ != null && average_ > 0 && d.total > 0) {
      const diff = d.total / average_ - 1;
      rows.push([tc("vsAverage"), `${diff >= 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))}%`]);
    }
    if (budget > 0) rows.push([tc("budget"), formatWhole(budget, locale)]);
    if (d.isCurrent && forecast != null) rows.push([tc("onPaceFor"), `~${formatWhole(forecast, locale)}`]);
    return <TipBody title={formatMonthName(d.month, locale)} rows={rows} />;
  };

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        containerRef.current = el;
      }}
      className="relative w-full"
      dir="ltr"
      style={{ minHeight: height }}
      onMouseLeave={() => {
        setActive(null);
        hide();
      }}
    >
      {width > 0 && (
        <Chart
          data={data}
          width={width}
          height={height}
          budget={budget}
          forecast={forecast}
          locale={locale}
          active={active}
          ariaLabel={t("trendChartLabel", { average: average != null ? formatWhole(average, locale) : "" })}
          onHover={(i, el) => {
            setActive(i);
            if (i === null || !el) hide();
            else show(el, tipFor(data[i]));
          }}
          onSelect={onSelect ? (i) => onSelect(data[i]) : undefined}
        />
      )}
      <ChartTooltip tip={tip} width={width} />
    </div>
  );
}

function ExpandedTrend({
  data,
  budget,
  forecast,
  average,
}: {
  data: HomeHistoricalTrendPoint[];
  budget: number;
  forecast: number | null;
  average: number | null;
}) {
  const tc = useTranslations("charts");
  const locale = useLocale() as Locale;
  const router = useRouter();
  return (
    <div className="space-y-5">
      <InteractiveChart
        data={data}
        budget={budget}
        forecast={forecast}
        average={average}
        height={EXPANDED_HEIGHT}
        onSelect={(d) => router.push(transactionsHref(d))}
      />
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-start text-[11px] text-muted-foreground uppercase ltr:tracking-[0.08em]">
            <th className="py-2 text-start font-semibold">{tc("period")}</th>
            <th className="py-2 text-end font-semibold">{tc("spent")}</th>
            <th className="py-2 text-end font-semibold">{tc("vsAverage")}</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...data].reverse().map((d) => {
            const diff = average && d.total > 0 ? d.total / average - 1 : null;
            return (
              <tr key={d.month} className={cn(d.isCurrent && "font-medium")}>
                <td className="py-2">{formatMonthName(d.month, locale)}</td>
                <td className="py-2 text-end tabular-nums">
                  <bdi dir="ltr">{formatWhole(d.total, locale)}</bdi>
                </td>
                <td className="py-2 text-end text-muted-foreground tabular-nums">
                  {diff === null ? "–" : <bdi dir="ltr">{`${diff >= 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))}%`}</bdi>}
                </td>
                <td className="py-2 text-end">
                  <Link
                    href={transactionsHref(d)}
                    className="rounded-sm text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {tc("showTransactions")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chart({
  data,
  width,
  height,
  budget,
  forecast,
  locale,
  active,
  ariaLabel,
  onHover,
  onSelect,
}: {
  data: HomeHistoricalTrendPoint[];
  width: number;
  height: number;
  budget: number;
  forecast: number | null;
  locale: Locale;
  active: number | null;
  ariaLabel: string;
  onHover: (i: number | null, el: Element | null) => void;
  onSelect?: (i: number) => void;
}) {
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const peak = Math.max(...data.map((d) => d.total), forecast ?? 0, budget);
  const step = niceStep(peak / 3);
  const max = Math.max(step, Math.ceil(peak / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 0.5; v += step) ticks.push(v);

  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const slot = plotW / data.length;
  const bw = Math.min(height > HEIGHT ? 48 : 34, slot * 0.58);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="block overflow-visible"
    >
      {ticks.map((g) => (
        <g key={g}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(g)}
            y2={y(g)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(g) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {g === 0 ? "0" : formatK(g)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const cx = PAD.left + slot * i + slot / 2;
        const x = cx - bw / 2;
        const isNow = d.isCurrent;
        const dim = active !== null && active !== i;
        const label = formatMonthName(d.month, locale, "short");
        return (
          <g key={d.month} className="transition-opacity duration-150" style={{ opacity: dim ? 0.45 : 1 }}>
            {isNow && forecast != null && (
              <>
                <rect
                  x={x}
                  y={y(forecast)}
                  width={bw}
                  height={Math.max(0, y(0) - y(forecast))}
                  rx={4}
                  className="fill-none stroke-primary"
                  strokeWidth={1.4}
                  strokeDasharray="3 3"
                />
                <text
                  x={cx}
                  y={y(forecast) - 6}
                  textAnchor="middle"
                  className="fill-foreground text-[10.5px] font-medium tabular-nums"
                >
                  {`~${formatK(forecast)}`}
                </text>
              </>
            )}
            {d.total > 0 && (
              <rect
                x={x}
                y={y(d.total)}
                width={bw}
                height={Math.max(1, y(0) - y(d.total))}
                rx={4}
                className={
                  isNow || active === i
                    ? "fill-primary"
                    : "fill-[color-mix(in_oklch,var(--primary)_30%,var(--muted))]"
                }
              />
            )}
            {!(isNow && forecast != null) && d.total > 0 && (
              <text
                x={cx}
                y={y(d.total) - 6}
                textAnchor="middle"
                className="fill-foreground text-[10.5px] font-medium tabular-nums"
              >
                {formatK(d.total)}
              </text>
            )}
            <text
              x={cx}
              y={height - 8}
              textAnchor="middle"
              className={
                isNow || active === i
                  ? "fill-foreground text-[11px] font-semibold"
                  : "fill-muted-foreground text-[11px]"
              }
            >
              {label}
            </text>
            {/* Whole-column hit area: easier to hover than a short bar. */}
            <rect
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${formatMonthName(d.month, locale)}: ${formatWhole(d.total, locale)}`}
              className={cn("outline-none", onSelect && "cursor-pointer")}
              onMouseEnter={(e) => onHover(i, e.currentTarget)}
              onFocus={(e) => onHover(i, e.currentTarget)}
              onBlur={() => onHover(null, null)}
              onClick={onSelect ? (e) => {
                e.stopPropagation();
                onSelect(i);
              } : undefined}
              onKeyDown={onSelect ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(i);
                }
              } : undefined}
            />
          </g>
        );
      })}

      {budget > 0 && (
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(budget)}
          y2={y(budget)}
          className="pointer-events-none stroke-foreground opacity-50"
          strokeWidth={1.2}
          strokeDasharray="3 4"
        />
      )}
    </svg>
  );
}

/** Rounds a raw step up to 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}
