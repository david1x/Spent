"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type { InsightSeverity } from "@/lib/insights-types";
import { getInsights } from "@/lib/api";
import { cn } from "@/lib/utils";
import { insightText } from "@/components/insights/insight-format";
import { CardAction, CardShell } from "./card-shell";
import { Skeleton } from "@/components/ui/skeleton";

const ICON: Record<InsightSeverity, { Icon: typeof Info; className: string }> = {
  alert: { Icon: CircleAlert, className: "text-[var(--status-over)]" },
  warn: { Icon: TriangleAlert, className: "text-[color-mix(in_oklch,var(--status-heads-up)_70%,var(--foreground))]" },
  info: { Icon: Info, className: "text-muted-foreground" },
  good: { Icon: CircleCheck, className: "text-[var(--status-on-track)]" },
};

/** The two findings that matter most right now, with a way into the Insights page. */
export function TopInsightCard() {
  const t = useTranslations("insights");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const { data, isLoading } = useQuery({ queryKey: ["insights"], queryFn: getInsights });
  const top = data?.feed.slice(0, 2) ?? [];

  return (
    <CardShell label={t("home.label")} action={<CardAction href="/insights">{t("home.seeAll")}</CardAction>}>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : top.length === 0 ? (
        <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <CircleCheck className="size-4 text-[var(--status-on-track)]" aria-hidden />
          {t("home.nothing")}
        </div>
      ) : (
        <ul className="space-y-3">
          {top.map((insight) => {
            const { title, detail } = insightText(insight, t, tCat, locale);
            const { Icon, className } = ICON[insight.severity];
            return (
              <li key={insight.id}>
                <Link
                  href="/insights"
                  className="-m-1.5 flex gap-2.5 rounded-lg p-1.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium leading-snug">{title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted-foreground">{detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}
