"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, CircleAlert, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";
import type { HomePaceStatus, HomeThisMonth } from "@/lib/types";
import { CardShell, CardAction } from "./card-shell";
import { ChartTooltip, TipBody, useChartTip } from "@/components/charts/chart-kit";
import {
  AMBER_INK,
  AMBER_SOFT_BG,
  bcpFor,
  formatMonthName,
  formatNumberWhole,
  formatWhole,
  parseLocalDate,
} from "./home-format";

interface Props {
  data: HomeThisMonth;
}

const bold = (chunks: ReactNode) => (
  <b className="font-medium text-foreground tabular-nums">{chunks}</b>
);

export function ThisMonthCard({ data }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const {
    spent,
    budget,
    paceStatus,
    dayOfPeriod,
    periodLength,
    expectedByToday,
    projected,
    lastPeriodSameDays,
    daysUntilPayday,
  } = data;
  const hasBudget = budget > 0;
  // Pay cycles (payday to payday) don't map onto a month name, so they're
  // labelled by their start date and compared with "your last pay cycle".
  const isPayCycle = parseLocalDate(data.periodStart).getDate() !== 1;
  const month = formatMonthName(data.periodStart, locale);
  const lastMonth = isPayCycle ? t("lastPayCycle") : formatMonthName(data.lastPeriodStart, locale);
  const periodOver = dayOfPeriod >= periodLength;
  const cardLabel = isPayCycle
    ? t("spentSinceDate", {
        date: parseLocalDate(data.periodStart).toLocaleDateString(
          locale === "he" ? "he-IL" : "en-IL",
          { day: "numeric", month: "short" }
        ),
      })
    : t("spentSoFarIn", { month });

  return (
    <CardShell
      label={cardLabel}
      action={<CardAction href="/budget">{t("budgetDetail")}</CardAction>}
    >
      <div className="flex flex-1 flex-col justify-between">
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
          <span className="font-serif text-5xl leading-none tracking-[-0.025em] tabular-nums lining-nums md:text-[3.5rem]">
            <span className="me-0.5 text-[0.6em] font-normal text-muted-foreground">₪</span>
            {formatNumberWhole(spent, locale)}
          </span>
          {hasBudget && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("ofBudget", { amount: formatWhole(budget, locale) })}
            </span>
          )}
          {paceStatus && <PacePill status={paceStatus} />}
        </div>

        {hasBudget ? (
          <PaceBar data={data} locale={locale} />
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            <Link
              href="/budget"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t("setBudgetHint")}
            </Link>
          </p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-dashed border-border pt-3.5 text-[13px] text-muted-foreground">
          {hasBudget && <span>{expectedLine()}</span>}
          {!periodOver && (
            <span>
              {t.rich("atThisPace", {
                days: dayOfPeriod,
                amount: formatWhole(projected, locale),
                b: bold,
              })}
            </span>
          )}
          {lastPeriodSameDays != null && <span>{lastPeriodLine(lastPeriodSameDays)}</span>}
          <span>{t("daysToPayday", { days: daysUntilPayday })}</span>
        </div>
      </div>
    </CardShell>
  );

  function expectedLine(): ReactNode {
    const diff = expectedByToday - spent;
    if (Math.abs(diff) < 1) return t("rightOnExpected", { day: dayOfPeriod });
    return t.rich(diff > 0 ? "underExpected" : "overExpected", {
      amount: formatWhole(diff, locale),
      day: dayOfPeriod,
      b: bold,
    });
  }

  function lastPeriodLine(last: number): ReactNode {
    const diff = spent - last;
    if (Math.abs(diff) < 1) {
      return t("sameAsLastPeriod", { days: dayOfPeriod, month: lastMonth });
    }
    return t.rich(diff < 0 ? "lessThanLastPeriod" : "moreThanLastPeriod", {
      amount: formatWhole(diff, locale),
      days: dayOfPeriod,
      month: lastMonth,
      b: bold,
    });
  }
}

function PacePill({ status }: { status: HomePaceStatus }) {
  const t = useTranslations("home");
  const config = {
    on: {
      label: t("paceOn"),
      icon: Check,
      className: "bg-primary/12 text-primary",
    },
    ahead: {
      label: t("paceAhead"),
      icon: TrendingUp,
      className: cn(AMBER_SOFT_BG, AMBER_INK),
    },
    over: {
      label: t("paceOver"),
      icon: CircleAlert,
      className: "bg-status-over/12 text-status-over",
    },
  }[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 self-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        config.className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {config.label}
    </span>
  );
}

function PaceBar({ data, locale }: { data: HomeThisMonth; locale: Locale }) {
  const t = useTranslations("home");
  const { spent, budget, projected, dayOfPeriod, periodLength, paceStatus } = data;
  const fill = clampPct((spent / budget) * 100);
  const forecast = clampPct((projected / budget) * 100);
  const today = clampPct((dayOfPeriod / periodLength) * 100);
  const startLabel = parseLocalDate(data.periodStart).toLocaleDateString(
    bcpFor(locale),
    { month: "short", day: "numeric" }
  );

  const fillClass =
    paceStatus === "over"
      ? "bg-status-over"
      : paceStatus === "ahead"
        ? "bg-status-heads-up"
        : "bg-primary";
  const hatchColor =
    paceStatus === "on" ? "var(--primary)" : "var(--status-heads-up)";

  const layout = useLabelLayout(today);
  const tc = useTranslations("charts");
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const body = (
    <TipBody
      title={t("paceTipTitle", { day: dayOfPeriod, total: periodLength })}
      rows={[
        [tc("spent"), formatWhole(spent, locale)],
        [tc("expectedByToday"), formatWhole(data.expectedByToday, locale)],
        [tc("budget"), formatWhole(budget, locale)],
        [tc("onPaceFor"), formatWhole(projected, locale)],
      ]}
    />
  );

  return (
    <div ref={containerRef} className="relative mt-6 mb-4">
      <Link
        href="/budget"
        className="block cursor-pointer rounded-full py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={(e) => show(e.currentTarget, body)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget, body)}
        onBlur={hide}
      >
      <div
        className="relative h-2.5 rounded-full bg-muted transition-[filter] hover:brightness-95"
        role="img"
        aria-label={t("paceBarLabel", {
          spent: formatWhole(spent, locale),
          budget: formatWhole(budget, locale),
          projected: formatWhole(projected, locale),
        })}
      >
        <div
          className="absolute inset-y-0 start-0 rounded-full"
          style={{
            width: `${forecast}%`,
            backgroundImage: `repeating-linear-gradient(-45deg, color-mix(in oklch, ${hatchColor} 32%, transparent) 0 4px, transparent 4px 8px)`,
          }}
        />
        <div
          className={cn("absolute inset-y-0 start-0 rounded-full", fillClass)}
          style={{ width: `${fill}%` }}
        />
        <div
          className="absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground rtl:translate-x-1/2"
          style={{ insetInlineStart: `${today}%` }}
        />
      </div>
      </Link>
      <ChartTooltip tip={tip} />
      <div
        ref={layout.containerRef}
        className="relative mt-2 h-5 text-xs text-muted-foreground tabular-nums"
      >
        <span
          ref={layout.startRef}
          className={cn("absolute start-0 top-0 whitespace-nowrap", !layout.showStart && "invisible")}
        >
          {startLabel}
        </span>
        <span
          ref={layout.todayRef}
          className="absolute top-0 whitespace-nowrap"
          style={{ insetInlineStart: layout.todayOffset }}
        >
          {t.rich("todayMarker", {
            day: dayOfPeriod,
            total: periodLength,
            b: (chunks) => <b className="font-medium text-foreground">{chunks}</b>,
          })}
        </span>
        <span
          ref={layout.endRef}
          className={cn("absolute end-0 top-0 whitespace-nowrap", !layout.showEnd && "invisible")}
        >
          {formatWhole(budget, locale)}
        </span>
      </div>
    </div>
  );
}

const LABEL_GAP = 12;

/**
 * Centers the "today" label under its marker, nudges it inside the track at
 * the edges, and hides the start or end label it would otherwise overlap.
 */
function useLabelLayout(todayPct: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLSpanElement>(null);
  const todayRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState({
    todayOffset: `${todayPct}%`,
    showStart: true,
    showEnd: true,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const width = container.clientWidth;
      const todayW = todayRef.current?.offsetWidth ?? 0;
      const startW = startRef.current?.offsetWidth ?? 0;
      const endW = endRef.current?.offsetWidth ?? 0;
      if (width === 0) return;
      const center = (todayPct / 100) * width;
      const offset = Math.min(Math.max(center - todayW / 2, 0), Math.max(0, width - todayW));
      const next = {
        todayOffset: `${offset}px`,
        showStart: offset >= startW + LABEL_GAP,
        showEnd: offset + todayW + LABEL_GAP <= width - endW,
      };
      setState((prev) =>
        prev.todayOffset === next.todayOffset &&
        prev.showStart === next.showStart &&
        prev.showEnd === next.showEnd
          ? prev
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [todayPct]);

  return { containerRef, startRef, todayRef, endRef, ...state };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
