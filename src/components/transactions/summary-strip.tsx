"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { previewCategorize } from "@/lib/api";
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
}

/** One line of totals for the filtered list, plus the review queue entry point. */
export function SummaryStrip({
  aggregates,
  loading,
  pendingReviewCount,
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
      {pendingReviewCount > 0 ? (
        <ReviewPill count={pendingReviewCount} className="ms-auto" />
      ) : null}
    </div>
  );
}

function ReviewPill({ count, className }: { count: number; className?: string }) {
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

  return (
    <>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium outline-none transition-colors hover:brightness-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70",
          className
        )}
        style={{
          backgroundColor:
            "color-mix(in oklch, var(--status-heads-up) 18%, var(--card))",
          color:
            "color-mix(in oklch, var(--status-heads-up) 55%, var(--foreground))",
        }}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <HelpCircle className="h-3.5 w-3.5" />
        )}
        <span className="tabular-nums">{t("reviewPill", { count })}</span>
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
