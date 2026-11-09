"use client";

import { useAccess } from "@/components/access-provider";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Check, HelpCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { approveTransactionCategory, getTransactions, previewCategorize } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { CategorizePreview } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { CategorizeReviewDialog } from "@/components/dashboard/categorize-review-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TransactionListAggregates } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

export const INCOME_INK =
  "color-mix(in oklch, var(--status-on-track) 70%, var(--foreground))";

interface SummaryStripProps {
  aggregates?: TransactionListAggregates;
  loading: boolean;
  pendingReviewCount: number;
  uncategorizedCount: number;
  onOpenReview: () => void;
}

/** One line of totals for the filtered list, plus the review queue entry point. */
export function SummaryStrip({
  aggregates,
  loading,
  pendingReviewCount,
  uncategorizedCount,
  onOpenReview,
}: SummaryStripProps) {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-2 px-0.5 text-[13px] text-muted-foreground">
      {loading || !aggregates ? (
        <Skeleton className="h-4 w-80 max-w-full" />
      ) : (
        <>
          <span>
            {t.rich("summaryCount", {
              count: aggregates.counts.all,
              b: (chunks) => (
                <b className="font-semibold tabular-nums text-foreground">
                  {chunks}
                </b>
              ),
            })}
          </span>
          <span>
            {t("summarySpent")}{" "}
            <b className="font-semibold tabular-nums text-foreground">
              {formatCurrency(aggregates.spent, "ILS", locale)}
            </b>
          </span>
          {aggregates.income > 0 ? (
            <span>
              {t("summaryIn")}{" "}
              <b
                className="font-semibold tabular-nums"
                style={{ color: INCOME_INK }}
              >
                <bdi>+{formatCurrency(aggregates.income, "ILS", locale)}</bdi>
              </b>
            </span>
          ) : null}
          {aggregates.notCounted > 0 ? (
            <span>
              {t("summaryNotCounted")}{" "}
              <b className="font-semibold tabular-nums text-foreground">
                {formatCurrency(aggregates.notCounted, "ILS", locale)}
              </b>
            </span>
          ) : null}
        </>
      )}
      {pendingReviewCount > 0 || uncategorizedCount > 0 ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {uncategorizedCount > 0 ? <CategorizeWithAiPill count={uncategorizedCount} /> : null}
          {pendingReviewCount > 0 ? (
            <button type="button" onClick={onOpenReview} className={PILL_CLASS} style={PILL_STYLE}>
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="tabular-nums">{t("reviewPill", { count: pendingReviewCount })}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const PILL_CLASS =
  "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium outline-none transition-colors hover:brightness-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70";
const PILL_STYLE = {
  backgroundColor: "color-mix(in oklch, var(--status-heads-up) 18%, var(--card))",
  color: "color-mix(in oklch, var(--status-heads-up) 55%, var(--foreground))",
};

/**
 * The review queue: rows the AI categorized without much confidence, or that
 * a rule flagged. Approving keeps the category; changing it teaches the AI.
 */
export function ReviewBanner({
  count,
  uncategorizedCount,
  onDone,
}: {
  count: number;
  uncategorizedCount: number;
  onDone: () => void;
}) {
  const t = useTranslations("transactions");
  const { readOnly } = useAccess();
  const queryClient = useQueryClient();
  const approveAll = useMutation({
    mutationFn: async () => {
      // The queue can span several pages; approve every row in it.
      const { transactions } = await getTransactions({ review: true, limit: 200 });
      await Promise.all(transactions.map((txn) => approveTransactionCategory(txn.id)));
      return transactions.length;
    },
    onSuccess: (n) => {
      for (const key of ["transactions", "summary", "transactions-summary", "home", "categories", "insights"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(t("reviewApprovedAll", { count: n }));
    },
    onError: () => toast.error(t("actionFailed")),
  });

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {count > 0 ? t("reviewTitle", { count }) : t("reviewAllDone")}
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground text-pretty">
          {count > 0 ? t("reviewExplain") : t("reviewAllDoneExplain")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {uncategorizedCount > 0 ? <CategorizeWithAiPill count={uncategorizedCount} /> : null}
        {count > 0 && !readOnly ? (
          <Button size="sm" variant="outline" onClick={() => approveAll.mutate()} disabled={approveAll.isPending}>
            {approveAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("reviewApproveAll", { count })}
          </Button>
        ) : null}
        <Button size="sm" onClick={onDone}>
          {t("reviewDone")}
        </Button>
      </div>
    </div>
  );
}

/** Rows with no category at all: AI categorization proposes one for each. */
function CategorizeWithAiPill({ count, className }: { count: number; className?: string }) {
  const { readOnly } = useAccess();
  const t = useTranslations("transactions");
  const tDash = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<CategorizePreview | null>(null);

  const mutation = useMutation({
    mutationFn: previewCategorize,
    onSuccess: (data) => {
      if (data.uncategorizedCount === 0) {
        toast.info(t("nothingLeftToCategorize"));
        return;
      }
      setPreview(data);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : tDash("categorizationFailed")
      );
    },
  });

  if (readOnly) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={cn(PILL_CLASS, className)}
        style={PILL_STYLE}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span className="tabular-nums">{t("uncategorizedPill", { count })}</span>
      </button>

      {preview && (
        <CategorizeReviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            queryClient.invalidateQueries({ queryKey: ["summary"] });
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({
              queryKey: ["transactions-summary"],
            });
            queryClient.invalidateQueries({ queryKey: ["categories"] });
          }}
        />
      )}
    </>
  );
}
