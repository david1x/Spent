"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { HomeHistoricalTrendPoint } from "@/lib/types";
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
const PAD = { left: 34, right: 6, top: 18, bottom: 26 };

export function HistoricalTrendCard({ data, budget, projected }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
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

          <div ref={wrapRef} className="mt-auto w-full" dir="ltr" style={{ minHeight: HEIGHT }}>
            {width > 0 && (
              <Chart
                data={data}
                width={width}
                budget={budget}
                forecast={forecast}
                locale={locale}
                ariaLabel={t("trendChartLabel", {
                  average: average != null ? formatWhole(average, locale) : "",
                })}
              />
            )}
          </div>

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

function Chart({
  data,
  width,
  budget,
  forecast,
  locale,
  ariaLabel,
}: {
  data: HomeHistoricalTrendPoint[];
  width: number;
  budget: number;
  forecast: number | null;
  locale: Locale;
  ariaLabel: string;
}) {
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const peak = Math.max(...data.map((d) => d.total), forecast ?? 0, budget);
  const step = niceStep(peak / 3);
  const max = Math.max(step, Math.ceil(peak / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 0.5; v += step) ticks.push(v);

  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const slot = plotW / data.length;
  const bw = Math.min(34, slot * 0.58);

  return (
    <svg
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
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
        const label = formatMonthName(d.month, locale, "short");
        const fullValue = formatWhole(d.total, locale);
        return (
          <g key={d.month}>
            <title>{`${formatMonthName(d.month, locale)}: ${fullValue}`}</title>
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
                  isNow
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
              y={HEIGHT - 8}
              textAnchor="middle"
              className={
                isNow
                  ? "fill-foreground text-[11px] font-semibold"
                  : "fill-muted-foreground text-[11px]"
              }
            >
              {label}
            </text>
          </g>
        );
      })}

      {budget > 0 && (
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(budget)}
          y2={y(budget)}
          className="stroke-foreground opacity-50"
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
