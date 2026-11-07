"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { CommittedPeriod, ForecastRange } from "@/lib/insights-types";
import { CardShell, CardAction } from "@/components/home/card-shell";
import { AMBER_INK, formatK, parseLocalDate, bcpFor } from "@/components/home/home-format";
import { cn } from "@/lib/utils";
import { day, money } from "./insight-format";

const STRIPES =
  "repeating-linear-gradient(135deg, color-mix(in oklch, var(--primary) 55%, transparent) 0 4px, color-mix(in oklch, var(--primary) 22%, transparent) 4px 8px)";

/** Where this period is likely to land, as a range against the target. */
export function ForecastCard({ data }: { data: ForecastRange }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const scaleMax = Math.max(data.high, data.target ?? 0, 1) * 1.08;
  const pct = (n: number) => `${Math.min(100, (n / scaleMax) * 100)}%`;
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

      <div className="relative mt-5 h-3.5 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 start-0 rounded-full bg-primary" style={{ width: pct(data.spent) }} />
        {data.fixedRemaining > 0 ? (
          <div
            className="absolute inset-y-0"
            style={{ insetInlineStart: pct(data.spent), width: `calc(${pct(base)} - ${pct(data.spent)})`, background: STRIPES }}
          />
        ) : null}
        <div
          className="absolute inset-y-0 rounded-e-full bg-[color-mix(in_oklch,var(--primary)_22%,transparent)] ring-1 ring-primary/30 ring-inset"
          style={{ insetInlineStart: pct(data.low), width: `max(4px, calc(${pct(data.high)} - ${pct(data.low)}))` }}
        />
        {data.target !== null ? (
          <div className="absolute -inset-y-1.5 w-0.5 rounded-full bg-foreground/70" style={{ insetInlineStart: pct(data.target) }} />
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
        <Legend swatch={<span className="size-2.5 rounded-sm bg-primary" />} label={t("forecast.spent")} value={money(data.spent, locale)} />
        <Legend
          swatch={<span className="size-2.5 rounded-sm" style={{ background: STRIPES }} />}
          label={t("forecast.fixed")}
          value={money(data.fixedRemaining, locale)}
        />
        <Legend
          swatch={<span className="size-2.5 rounded-sm bg-[color-mix(in_oklch,var(--primary)_22%,transparent)] ring-1 ring-primary/30" />}
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

/** Money already spoken for in the coming periods: installments plus recurring charges. */
export function CommittedCard({ periods }: { periods: CommittedPeriod[] }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const max = Math.max(...periods.map((p) => p.installments + p.recurring), 1);
  const plans = new Map<string, CommittedPeriod["plans"][number]>();
  for (const p of periods) for (const plan of p.plans) if (!plans.has(plan.merchant)) plans.set(plan.merchant, plan);
  const next = periods[0];

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
      <div dir="ltr" className="mt-4 flex h-32 items-end gap-2" role="img" aria-label={t("committed.chartLabel")}>
        {periods.map((p) => {
          const total = p.installments + p.recurring;
          return (
            <div key={p.periodStart} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10.5px] text-muted-foreground tabular-nums">{formatK(total)}</span>
              <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(total / max) * 78}%` }}>
                <div className="bg-[color-mix(in_oklch,var(--primary)_35%,transparent)]" style={{ height: `${(p.recurring / Math.max(total, 1)) * 100}%` }} />
                <div className="bg-primary" style={{ height: `${(p.installments / Math.max(total, 1)) * 100}%` }} />
              </div>
              <span className="text-[10.5px] text-muted-foreground">
                {parseLocalDate(p.periodStart).toLocaleDateString(bcpFor(locale), { month: "short" })}
              </span>
            </div>
          );
        })}
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
      </div>
      {plans.size > 0 ? (
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

