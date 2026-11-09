"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Check, Clock, Loader2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryChip } from "@/components/transactions/category-chip";
import { useAccess } from "@/components/access-provider";
import { decideCategoryRequests, listCategoryRequests, withdrawCategoryRequest } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { translateCategoryName } from "@/lib/i18n-data";
import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import type { CategoryRequest } from "@/lib/types";

const bcp47 = (locale: Locale) => (locale === "he" ? "he-IL" : "en-IL");

export const CATEGORY_REQUESTS_KEY = ["category-requests"] as const;

/** Open suggestions in the active workspace, and a lookup by transaction. */
export function useCategoryRequests() {
  const query = useQuery({
    queryKey: CATEGORY_REQUESTS_KEY,
    queryFn: listCategoryRequests,
    staleTime: 15_000,
  });
  const requests = query.data?.requests ?? [];
  const byTransaction = new Map(requests.map((r) => [r.transactionId, r]));
  return { requests, byTransaction, isLoading: query.isLoading };
}

/** Approve, decline and take back, with the refetches each one needs. */
export function useCategoryRequestActions() {
  const t = useTranslations("sharing.requests");
  const queryClient = useQueryClient();
  const refresh = () => {
    // Approving changes categories, so everything that shows them refetches.
    void queryClient.invalidateQueries();
  };
  const decide = useMutation({
    mutationFn: ({ ids, decision }: { ids: number[]; decision: "approve" | "decline" }) =>
      decideCategoryRequests(ids, decision),
    onSuccess: (res, { decision }) => {
      toast.success(decision === "approve" ? t("approvedToast", { count: res.decided }) : t("declinedToast", { count: res.decided }));
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });
  const withdraw = useMutation({
    mutationFn: (id: number) => withdrawCategoryRequest(id),
    onSuccess: () => {
      toast.success(t("withdrawnToast"));
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("failed")),
  });
  return { decide, withdraw };
}

/**
 * The owner's inbox of category suggestions from the people they shared with,
 * or, for a viewer, their own suggestions still waiting. Renders nothing when
 * there are none.
 */
export function CategoryRequestsCard({ className }: { className?: string }) {
  const t = useTranslations("sharing.requests");
  const { readOnly, ownerName } = useAccess();
  const { requests } = useCategoryRequests();
  const { decide, withdraw } = useCategoryRequestActions();
  const [expanded, setExpanded] = useState(false);

  if (requests.length === 0) return null;
  const VISIBLE = 4;
  const shown = expanded ? requests : requests.slice(0, VISIBLE);
  const busyIds = decide.isPending ? (decide.variables?.ids ?? []) : [];

  return (
    <section
      className={cn(
        "rounded-2xl border border-[color-mix(in_oklch,var(--status-heads-up)_35%,var(--border))] bg-card",
        className
      )}
      aria-labelledby="category-requests-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 id="category-requests-title" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 shrink-0 text-[color-mix(in_oklch,var(--status-heads-up)_70%,var(--foreground))]" />
            {readOnly ? t("viewerTitle") : t("ownerTitle")}
            <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {requests.length}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {readOnly ? t("viewerHint", { owner: ownerName ?? t("theOwner") }) : t("ownerHint")}
          </p>
        </div>
        {!readOnly && requests.length > 1 ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ ids: requests.map((r) => r.id), decision: "approve" })}
          >
            <Check className="h-3.5 w-3.5" />
            {t("approveAll")}
          </Button>
        ) : null}
      </header>
      <ul className="divide-y divide-border">
        {shown.map((req) => (
          <RequestRow
            key={req.id}
            req={req}
            readOnly={readOnly}
            busy={busyIds.includes(req.id) || (withdraw.isPending && withdraw.variables === req.id)}
            onApprove={() => decide.mutate({ ids: [req.id], decision: "approve" })}
            onDecline={() => decide.mutate({ ids: [req.id], decision: "decline" })}
            onWithdraw={() => withdraw.mutate(req.id)}
          />
        ))}
      </ul>
      {requests.length > VISIBLE ? (
        <div className="border-t border-border px-4 py-2 sm:px-5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? t("showFewer") : t("showAll", { count: requests.length })}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function RequestRow({
  req,
  readOnly,
  busy,
  onApprove,
  onDecline,
  onWithdraw,
}: {
  req: CategoryRequest;
  readOnly: boolean;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
}) {
  const t = useTranslations("sharing.requests");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const name = req.transaction.displayName || req.transaction.description;
  const date = new Date(req.transaction.date).toLocaleDateString(bcp47(locale), { day: "numeric", month: "short" });

  return (
    <li className={cn("flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5", busy && "opacity-60")}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium" title={req.transaction.description}>
            <bdi>{name}</bdi>
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            <bdi>{formatCurrency(req.transaction.chargedAmount, "ILS", locale)}</bdi>
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {req.from ? (
            <CategoryChip variant="normal" label={translateCategoryName(req.from.name, tCat)} color={req.from.color} />
          ) : (
            <CategoryChip variant="uncategorized" label={t("uncategorized")} />
          )}
          <ArrowRight aria-label={t("changeTo")} className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
          <CategoryChip variant="normal" label={translateCategoryName(req.to.name, tCat)} color={req.to.color} />
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          {readOnly ? date : t("byLine", { name: req.requestedBy, date })}
          {req.note ? (
            <>
              {" · "}
              <bdi className="italic">“{req.note}”</bdi>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:justify-end">
        {readOnly ? (
          <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy} onClick={onWithdraw}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            {t("withdraw")}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" className="flex-1 gap-1.5 sm:flex-none" disabled={busy} onClick={onDecline}>
              <X className="h-3.5 w-3.5" />
              {t("decline")}
            </Button>
            <Button size="sm" className="flex-1 gap-1.5 sm:flex-none" disabled={busy} onClick={onApprove}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t("approve")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
