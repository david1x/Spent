"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChartTooltip, TipBody, useChartTip } from "@/components/charts/chart-kit";
import { ArrowLeftRight } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type { HomeCashFlow } from "@/lib/types";
import { CardShell } from "./card-shell";
import { formatWhole } from "./home-format";

interface Props {
  data: HomeCashFlow;
  period: { from: string; to: string } | null;
}

export function CashFlowCard({ data, period }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("charts");
  const locale = useLocale() as Locale;
  const { containerRef, tip, show, hide } = useChartTip<HTMLDivElement>();
  const link = (segment: string) =>
    period ? `/transactions?segment=${segment}&from=${period.from}&to=${period.to}` : "/transactions";
  const flow = data.income + data.expenses;
  const pct = (n: number) => (flow > 0 ? `${Math.round((n / flow) * 100)}%` : "0%");
  const { income, expenses, net } = data;
  const overspent = net < 0;
  const hasFlow = income > 0 || expenses > 0;

  return (
    <CardShell label={t("moneyInAndOut")}>
      <div className="flex flex-1 flex-col gap-3">
        {hasFlow && (
          <div ref={containerRef} className="relative mt-1 mb-0.5" onMouseLeave={hide}>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
              {income > 0 && (
                <Link
                  href={link("counted_income")}
                  aria-label={`${t("cashFlowIn")}: ${formatWhole(income, locale)}`}
                  className="block bg-status-on-track outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ flexGrow: income }}
                  onMouseEnter={(e) => show(e.currentTarget, <TipBody title={t("cashFlowIn")} rows={[[tc("amount"), `+${formatWhole(income, locale)}`], [tc("share"), pct(income)]]} />)}
                />
              )}
              {expenses > 0 && (
                <Link
                  href={link("spending")}
                  aria-label={`${t("cashFlowSpent")}: ${formatWhole(expenses, locale)}`}
                  className="block bg-foreground/70 outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ flexGrow: expenses }}
                  onMouseEnter={(e) => show(e.currentTarget, <TipBody title={t("cashFlowSpent")} rows={[[tc("amount"), formatWhole(expenses, locale)], [tc("share"), pct(expenses)]]} />)}
                />
              )}
            </div>
            <ChartTooltip tip={tip} />
          </div>
        )}

        <Link href={link("counted_income")} className="-mx-2 rounded-md px-2 py-0.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
          <Row label={t("cashFlowIn")}>
            <span className="text-primary">+{formatWhole(income, locale)}</span>
          </Row>
        </Link>
        <Link href={link("spending")} className="-mx-2 rounded-md px-2 py-0.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
          <Row label={t("cashFlowSpent")}>{formatWhole(expenses, locale)}</Row>
        </Link>

        <div className="border-t border-border pt-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <span className="text-[13.5px]">{t("leftThisMonth")}</span>
            <span className="font-serif text-[1.625rem] leading-none tabular-nums">
              {overspent ? "−" : ""}
              {formatWhole(net, locale)}
            </span>
          </div>
          {overspent && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-status-over" aria-hidden />
              <span className="font-medium text-status-over">{t("overspentWord")}</span>
              <span>{t("overspentHint")}</span>
            </p>
          )}
        </div>

        {data.notCounted > 0 ? (
          <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[12.5px] text-muted-foreground">
            <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              <span className="font-medium text-foreground tabular-nums">
                {t("cashFlowNotCounted", {
                  amount: formatWhole(data.notCounted, locale),
                })}
                .
              </span>{" "}
              {t("cashFlowNotCountedHint")}
            </p>
          </div>
        ) : null}
      </div>
    </CardShell>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-[13.5px]">
      <span>{label}</span>
      <span className="text-[15px] font-medium tabular-nums">{children}</span>
    </div>
  );
}
