"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type { CommittedPeriod, ForecastRange, UpcomingCharge } from "@/lib/insights-types";
import { CardShell, CardAction } from "@/components/home/card-shell";
import { AMBER_INK, formatK, parseLocalDate, bcpFor } from "@/components/home/home-format";
import { ChartTooltip, ExpandableChart, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { cn } from "@/lib/utils";
import { day, money } from "./insight-format";

const STRIPES =
  "repeating-linear-gradient(135deg, color-mix(in oklch, var(--primary) 55%, transparent) 0 4px, color-mix(in oklch, var(--primary) 22%, transparent) 4px 8px)";
const BAND = "color-mix(in oklch, var(--primary) 22%, transparent)";

/** Where this period is likely to land, as a range against the target. */
export function ForecastCard({ data, upcoming }: { data: ForecastRange; upcoming: UpcomingCharge[] }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const base = data.spent + data.fixedRemaining;
  const over = data.target !== null && data.mid > data.target;
  const delta = data.target !== null ? Math.abs(data.mid - data.target) : 0;
  const sourceKey = data.targetSource ?? "typical";

  return (
    <CardShell
      label={t("forecast.label")}
      action={t("forecast.dayOf", { day: data.dayOfPeriod, total: data.periodLength })}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
          <bdi dir="ltr">
            {money(data.low, locale)}–{money(data.high, locale)}
          </bdi>
        </span>
        <span className="text-[13px] text-muted-foreground">
          {t("forecast.likelyBy", { end: day(data.periodEnd, locale) })}
        </span>
      </div>

      <ExpandableChart
        className="mt-5 pt-1"
        title={t("forecast.label")}
        description={t("forecast.expandedHint")}
        expanded={<ForecastExpanded data={data} upcoming={upcoming} />}
      >
        <RangeBar data={data} />
      </ExpandableChart>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
        <Legend swatch={<span className="size-2.5 rounded-sm bg-primary" />} label={t("forecast.spent")} value={money(data.spent, locale)} />
        <Legend
          swatch={<span className="size-2.5 rounded-sm" style={{ background: STRIPES }} />}
          label={t("forecast.fixed")}
          value={money(data.fixedRemaining, locale)}
        />
        <Legend
          swatch={<span className="size-2.5 rounded-sm ring-1 ring-primary/30" style={{ background: BAND }} />}
          label={t("forecast.everyday")}
          value={`${money(data.low - base, locale)}–${money(data.high - base, locale)}`}
        />
        {data.target !== null ? (
          <Legend
            swatch={<span className="h-3 w-0.5 rounded-full bg-foreground/70" />}
            label={t(`forecast.target_${sourceKey}` as "forecast.target_target")}
            value={money(data.target, locale)}
          />
        ) : null}
      </dl>

      {data.target !== null ? (
        <p className={cn("mt-4 text-[13px]", over ? AMBER_INK : "text-muted-foreground")}>
          {over
            ? t(`forecast.over_${sourceKey}` as "forecast.over_target", { amount: money(delta, locale) })
            : t(`forecast.under_${sourceKey}` as "forecast.under_target", { amount: money(delta, locale) })}
        </p>
      ) : null}
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {data.cyclesUsed >= 3 ? t("forecast.how", { count: data.cyclesUsed }) : t("forecast.howThin")}
      </p>
    </CardShell>
  );
}

/** Spent, still-due fixed charges and the everyday range, each with its own tooltip. */
function RangeBar({ data, tall = false }: { data: ForecastRange; tall?: boolean }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const scaleMax = Math.max(data.high, data.target ?? 0, 1) * 1.08;
  const pct = (n: number) => `${Math.min(100, (n / scaleMax) * 100)}%`;
  const base = data.spent + data.fixedRemaining;
  const hover = (body: React.ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget, body),
  });
  const sourceKey = data.targetSource ?? "typical";

  return (
    <div ref={containerRef} className="relative" onMouseLeave={hide}>
      <div className={cn("relative rounded-full bg-muted", tall ? "h-6" : "h-3.5")}>
        <div
          className="absolute inset-y-0 start-0 rounded-full bg-primary transition-[filter] hover:brightness-110"
          style={{ width: pct(data.spent) }}
          {...hover(<TipBody title={t("forecast.spent")} rows={[[t("forecast.amount"), money(data.spent, locale)]]} />)}
        />
        {data.fixedRemaining > 0 ? (
          <div
            className="absolute inset-y-0 transition-[filter] hover:brightness-110"
            style={{ insetInlineStart: pct(data.spent), width: `calc(${pct(base)} - ${pct(data.spent)})`, background: STRIPES }}
            {...hover(<TipBody title={t("forecast.fixed")} rows={[[t("forecast.amount"), money(data.fixedRemaining, locale)]]} />)}
          />
        ) : null}
        <div
          className="absolute inset-y-0 rounded-e-full ring-1 ring-primary/30 ring-inset transition-[filter] hover:brightness-95"
          style={{ insetInlineStart: pct(data.low), width: `max(4px, calc(${pct(data.high)} - ${pct(data.low)}))`, background: BAND }}
          {...hover(
            <TipBody
              title={t("forecast.likelyTotal")}
              rows={[
                [t("forecast.low"), money(data.low, locale)],
                [t("forecast.mid"), money(data.mid, locale)],
                [t("forecast.high"), money(data.high, locale)],
              ]}
            />
          )}
        />
        {data.target !== null ? (
          <div
            className="absolute -inset-y-1.5 w-1.5 -translate-x-1/2 rtl:translate-x-1/2"
            style={{ insetInlineStart: pct(data.target) }}
            {...hover(<TipBody title={t(`forecast.target_${sourceKey}` as "forecast.target_target")} rows={[[t("forecast.amount"), money(data.target, locale)]]} />)}
          >
            <div className="mx-auto h-full w-0.5 rounded-full bg-foreground/70" />
          </div>
        ) : null}
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

/** Larger view: past periods next to this one's range, and what's still due. */
function ForecastExpanded({ data, upcoming }: { data: ForecastRange; upcoming: UpcomingCharge[] }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const due = upcoming.filter((u) => u.date <= data.periodEnd && (u.kind === "recurring" || u.kind === "installment"));
  const columns = [...data.history.map((h) => ({ ...h, current: false })), { periodStart: data.periodStart, periodEnd: data.periodEnd, total: data.spent, current: true }];
  const max = Math.max(...columns.map((c) => c.total), data.high, data.target ?? 0, 1) * 1.1;
  const h = (n: number) => `${(n / max) * 100}%`;
  const label = (iso: string) => parseLocalDate(iso).toLocaleDateString(bcpFor(locale), { month: "short" });

  return (
    <div className="space-y-6">
      <RangeBar data={data} tall />
      <div>
        <h4 className="mb-2 text-[12px] font-semibold text-muted-foreground">{t("forecast.historyTitle")}</h4>
        <div ref={containerRef} className="relative" onMouseLeave={hide}>
          <div dir="ltr" className="relative flex h-48 items-end gap-2 border-b border-border">
            {data.target !== null ? (
              <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/50" style={{ bottom: h(data.target) }} />
            ) : null}
            {columns.map((c) => (
              <div
                key={c.periodStart}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseEnter={(e) =>
                  show(
                    e.currentTarget,
                    <TipBody
                      title={`${day(c.periodStart, locale)} – ${day(c.periodEnd, locale)}`}
                      rows={
                        c.current
                          ? [
                              [t("forecast.spent"), money(c.total, locale)],
                              [t("forecast.likelyTotal"), `${money(data.low, locale)}–${money(data.high, locale)}`],
                            ]
                          : [[t("forecast.total"), money(c.total, locale)]]
                      }
                    />
                  )
                }
              >
                {c.current ? (
                  <div
                    className="absolute w-full max-w-12 rounded-t-md ring-1 ring-primary/30 ring-inset"
                    style={{ bottom: h(data.low), height: `calc(${h(data.high)} - ${h(data.low)})`, background: BAND }}
                  />
                ) : null}
                <div
                  className={cn("relative w-full max-w-12 rounded-t-md transition-colors", c.current ? "bg-primary" : "bg-[color-mix(in_oklch,var(--primary)_30%,var(--muted))] hover:bg-[color-mix(in_oklch,var(--primary)_55%,var(--muted))]")}
                  style={{ height: h(c.total) }}
                />
              </div>
            ))}
          </div>
          <div dir="ltr" className="mt-1.5 flex gap-2">
            {columns.map((c) => (
              <div key={c.periodStart} className={cn("flex-1 text-center text-[11px] text-muted-foreground", c.current && "font-semibold text-foreground")}>
                {label(c.periodStart)}
              </div>
            ))}
          </div>
          <ChartTooltip tip={tip} />
        </div>
      </div>
      <div>
        <h4 className="mb-1 text-[12px] font-semibold text-muted-foreground">{t("forecast.dueTitle")}</h4>
        {due.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("forecast.dueNone")}</p>
        ) : (
          <ul className="divide-y divide-border text-[13px]">
            {due.map((u, i) => (
              <li key={`${u.merchant}-${i}`} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{day(u.date, locale)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{u.merchant}</bdi>
                </span>
                <span className="font-medium tabular-nums">
                  <bdi dir="ltr">
                    {u.estimated ? "≈ " : ""}
                    {money(u.amount, locale)}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-start gap-1.5 text-muted-foreground [&>span:first-child]:mt-1">
        {swatch}
        <span className="leading-tight">{label}</span>
      </dt>
      <dd className="mt-0.5 font-medium tabular-nums">
        <bdi dir="ltr">{value}</bdi>
      </dd>
    </div>
  );
}

/** Money already spoken for: the rest of this period, then the coming ones. Click a month for what's in it. */
export function CommittedCard({ periods }: { periods: CommittedPeriod[] }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(...periods.map((p) => p.installments + p.recurring), 1);
  const plans = new Map<string, CommittedPeriod["plans"][number]>();
  for (const p of periods) for (const plan of p.plans) if (!plans.has(plan.merchant)) plans.set(plan.merchant, plan);
  const next = periods.find((p) => !p.current);
  const chosen = periods.find((p) => p.periodStart === selected) ?? null;
  const month = (iso: string, style: "short" | "long" = "short") =>
    parseLocalDate(iso).toLocaleDateString(bcpFor(locale), { month: style, ...(style === "long" ? { year: "numeric" } : {}) });

  return (
    <CardShell label={t("committed.label")} action={<CardAction href="#recurring">{t("committed.seeRecurring")}</CardAction>}>
      {next ? (
        <p className="text-[13px] text-muted-foreground">
          {t.rich("committed.next", {
            amount: money(next.installments + next.recurring, locale),
            b: (c) => <b className="font-semibold text-foreground tabular-nums">{c}</b>,
          })}
        </p>
      ) : null}
      <div ref={containerRef} className="relative" onMouseLeave={hide}>
        <div dir="ltr" className="mt-4 flex h-32 items-end gap-2" role="group" aria-label={t("committed.chartLabel")}>
          {periods.map((p) => {
            const total = p.installments + p.recurring;
            const isSel = selected === p.periodStart;
            const dim = selected !== null && !isSel;
            const heading = p.current ? t("committed.stillDue", { month: month(p.periodStart, "long") }) : month(p.periodStart, "long");
            return (
              <button
                key={p.periodStart}
                type="button"
                aria-pressed={isSel}
                aria-label={`${heading}: ${money(total, locale)}`}
                className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ opacity: dim ? 0.45 : 1 }}
                onMouseEnter={(e) =>
                  show(
                    e.currentTarget,
                    <TipBody
                      title={heading}
                      rows={[
                        [t("committed.installments"), money(p.installments, locale)],
                        [t("committed.recurring"), money(p.recurring, locale)],
                        [t("committed.total"), money(total, locale)],
                      ]}
                    />
                  )
                }
                onClick={() => setSelected(isSel ? null : p.periodStart)}
              >
                <span className="text-[10.5px] text-muted-foreground tabular-nums">{formatK(total)}</span>
                <div
                  className={cn(
                    "flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md transition-[filter] group-hover:brightness-110",
                    // Only part of the period is left, so the bar is outlined to read as "remaining".
                    p.current && "outline-1 outline-dashed outline-offset-2 outline-muted-foreground/50",
                    isSel && "ring-2 ring-ring ring-offset-1 ring-offset-card"
                  )}
                  style={{ height: `${(total / max) * 78}%` }}
                >
                  <div className="bg-[color-mix(in_oklch,var(--primary)_35%,transparent)]" style={{ height: `${(p.recurring / Math.max(total, 1)) * 100}%` }} />
                  <div className="bg-primary" style={{ height: `${(p.installments / Math.max(total, 1)) * 100}%` }} />
                </div>
                <span className={cn("text-[10.5px] text-muted-foreground", (isSel || p.current) && "font-semibold text-foreground")}>
                  {p.current ? t("committed.now") : month(p.periodStart)}
                </span>
              </button>
            );
          })}
        </div>
        <ChartTooltip tip={tip} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" />
          {t("committed.installments")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[color-mix(in_oklch,var(--primary)_35%,transparent)]" />
          {t("committed.recurring")}
        </span>
        {!chosen ? <span className="ms-auto">{t("committed.clickHint")}</span> : null}
      </div>

      {chosen ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-[12.5px] font-semibold">
              {t(chosen.current ? "committed.stillDue" : "committed.inPeriod", { month: month(chosen.periodStart, "long") })}
            </h4>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label={t("committed.close")}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {chosen.plans.length + chosen.items.length === 0 ? (
            <p className="py-1.5 text-[12.5px] text-muted-foreground">{t("committed.nothingDue")}</p>
          ) : null}
          <ul className="max-h-56 divide-y divide-border overflow-y-auto text-[13px]">
            {chosen.plans.map((plan) => (
              <li key={`p-${plan.merchant}`} className="flex items-center gap-2 py-1.5">
                <span className="size-2 shrink-0 rounded-sm bg-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{plan.merchant}</bdi>
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground">{t("committed.paymentsLeft", { count: plan.remaining })}</span>
                <span className="w-20 shrink-0 text-end font-medium tabular-nums">
                  <bdi dir="ltr">{money(plan.amount, locale)}</bdi>
                </span>
              </li>
            ))}
            {chosen.items.map((item, i) => (
              <li key={`r-${item.merchant}-${i}`} className="flex items-center gap-2 py-1.5">
                <span className="size-2 shrink-0 rounded-sm bg-[color-mix(in_oklch,var(--primary)_35%,transparent)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <bdi>{item.merchant}</bdi>
                </span>
                <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{day(item.date, locale)}</span>
                <span className="w-20 shrink-0 text-end font-medium tabular-nums">
                  <bdi dir="ltr">
                    {item.variable ? "≈ " : ""}
                    {money(item.amount, locale)}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : plans.size > 0 ? (
        <ul className="mt-4 divide-y divide-border border-t border-border text-[13px]">
          {[...plans.values()].slice(0, 4).map((plan) => (
            <li key={plan.merchant} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">
                <bdi>{plan.merchant}</bdi>
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t("committed.planLine", { amount: money(plan.amount, locale), end: day(plan.endsOn, locale, { day: undefined }) })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{t("committed.noPlans")}</p>
      )}
    </CardShell>
  );
}
