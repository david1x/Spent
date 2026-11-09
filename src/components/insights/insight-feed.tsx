"use client";

import { useAccess } from "@/components/access-provider";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Info,
  Loader2,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type { Insight, InsightLink, InsightSeverity } from "@/lib/insights-types";
import {
  restoreHiddenInsights,
  sendInsightFeedback,
  summarizeInsights,
  type InsightFeedbackAction,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CardShell } from "@/components/home/card-shell";
import { cn } from "@/lib/utils";
import { insightText } from "./insight-format";

/** Visible before "Show more"; research on alert fatigue puts the limit around five. */
const VISIBLE = 5;

const SEVERITY: Record<InsightSeverity, { Icon: typeof Info; className: string }> = {
  alert: { Icon: CircleAlert, className: "text-[var(--status-over)]" },
  warn: { Icon: TriangleAlert, className: "text-[color-mix(in_oklch,var(--status-heads-up)_70%,var(--foreground))]" },
  info: { Icon: Info, className: "text-muted-foreground" },
  good: { Icon: CircleCheck, className: "text-[var(--status-on-track)]" },
};

export function linkHref(link: InsightLink | undefined): string | null {
  if (!link) return null;
  if (link.anchor) return `#${link.anchor}`;
  const sp = new URLSearchParams();
  if (link.search) sp.set("search", link.search);
  if (link.categoryId) sp.set("category", String(link.categoryId));
  if (link.from && link.to) {
    sp.set("from", link.from);
    sp.set("to", link.to);
  }
  const q = sp.toString();
  return q ? `/transactions?${q}` : null;
}

export function InsightFeed({
  feed,
  hiddenCount,
  aiProvider,
}: {
  feed: Insight[];
  hiddenCount: number;
  aiProvider: "claude" | "ollama" | null;
}) {
  const t = useTranslations("insights");
  const { readOnly } = useAccess();
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const shown = expanded ? feed : feed.slice(0, VISIBLE);

  const feedback = useMutation({
    mutationFn: (v: { key: string; action: InsightFeedbackAction; days?: number }) =>
      sendInsightFeedback(v.key, v.action, v.days),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(t(`toast.${v.action}` as "toast.dismissed"));
    },
    onError: () => toast.error(t("toast.failed")),
  });
  const restore = useMutation({
    mutationFn: restoreHiddenInsights,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["insights"] }),
  });

  return (
    <CardShell label={t("feed.label")} action={feed.length > 0 ? t("feed.count", { count: feed.length }) : undefined}>
      {aiProvider && !readOnly ? <AiSummary provider={aiProvider} /> : null}
      {feed.length === 0 ? (
        <div className="flex items-center gap-2.5 py-2 text-[13px] text-muted-foreground">
          <CircleCheck className="size-4 text-[var(--status-on-track)]" aria-hidden />
          {t("feed.empty")}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {shown.map((insight) => (
            <FeedItem
              key={insight.id}
              insight={insight}
              busy={feedback.isPending && feedback.variables?.key === insight.id}
              readOnly={readOnly}
              onAction={(action, key, days) => feedback.mutate({ key: key ?? insight.id, action, days })}
            />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        {feed.length > VISIBLE ? (
          <button
            type="button"
            className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? t("feed.showLess") : t("feed.showMore", { count: feed.length - VISIBLE })}
          </button>
        ) : (
          <span />
        )}
        {hiddenCount > 0 && !readOnly ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("feed.hidden", { count: hiddenCount })}
          </button>
        ) : null}
      </div>
    </CardShell>
  );
}

function FeedItem({
  insight,
  busy,
  readOnly,
  onAction,
}: {
  insight: Insight;
  busy: boolean;
  /** A viewer can follow the link, not snooze or dismiss the owner's feed. */
  readOnly: boolean;
  onAction: (action: InsightFeedbackAction, key?: string, days?: number) => void;
}) {
  const t = useTranslations("insights");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const { title, detail } = insightText(insight, t, tCat, locale);
  const { Icon, className } = SEVERITY[insight.severity];
  const href = linkHref(insight.link);

  return (
    <li className={cn("group flex gap-3 rounded-lg px-2 py-3", busy && "opacity-50")}>
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", className)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium leading-snug text-pretty">{title}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground text-pretty">{detail}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
          {href ? (
            <Link
              href={href}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {insight.link?.anchor ? t("feed.jump") : t("feed.showTransactions")}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
          {readOnly ? null : (
            <>
          {insight.feedback ? (
            <ActionButton onClick={() => onAction(insight.feedback!.action, insight.feedback!.key)}>
              {t(`feed.${insight.feedback.action}` as "feed.not_recurring")}
            </ActionButton>
          ) : null}
          <ActionButton onClick={() => onAction("snoozed", undefined, 7)} icon={<Clock className="size-3.5" aria-hidden />}>
            {t("feed.snooze")}
          </ActionButton>
          <ActionButton onClick={() => onAction("dismissed")} icon={<X className="size-3.5" aria-hidden />}>
            {t("feed.dismiss")}
          </ActionButton>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function ActionButton({ children, onClick, icon }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Optional wording by the connected AI. Only the figures on this page are
 * sent; with Ollama nothing leaves the computer.
 */
function AiSummary({ provider }: { provider: "claude" | "ollama" }) {
  const t = useTranslations("insights");
  const locale = useLocale();
  const summary = useMutation({ mutationFn: () => summarizeInsights(locale) });
  const providerName = provider === "claude" ? "Claude" : t("ai.localModel");

  return (
    <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3.5">
      {summary.data ? (
        <>
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground uppercase ltr:tracking-[0.09em]">
            {t("ai.writtenBy", { provider: providerName })}
          </div>
          <div className="space-y-1 text-[13.5px] leading-relaxed whitespace-pre-line">{summary.data.text}</div>
          <button
            type="button"
            onClick={() => summary.mutate()}
            disabled={summary.isPending}
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm text-[12px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {summary.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
            {t("ai.again")}
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-muted-foreground">
            {provider === "claude" ? t("ai.privacyClaude") : t("ai.privacyLocal")}
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => summary.mutate()} disabled={summary.isPending}>
            {summary.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {summary.isPending ? t("ai.writing") : t("ai.summarize", { provider: providerName })}
          </Button>
        </div>
      )}
      {summary.isError ? <p className="mt-2 text-[12.5px] text-destructive">{t("ai.failed")}</p> : null}
    </div>
  );
}
