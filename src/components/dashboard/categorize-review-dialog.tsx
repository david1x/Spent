"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { applyCategorize, getCategories } from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CategorizePreview } from "@/lib/api";

interface CategorizeReviewDialogProps {
  preview: CategorizePreview;
  onClose: () => void;
  onApplied: () => void;
}

export function CategorizeReviewDialog({
  preview,
  onClose,
  onApplied,
}: CategorizeReviewDialogProps) {
  const t = useTranslations("categorizeReview");
  const tCat = useTranslations("categoriesSeeded");
  const applyRef = useRef<HTMLButtonElement>(null);
  const { data: existingCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });

  // Track per-proposal state: approved (default true), or a fallback name.
  const [approvedMap, setApprovedMap] = useState<Record<string, boolean>>(
    () => Object.fromEntries(preview.proposedCategories.map((p) => [p.name, true]))
  );

  const applyMutation = useMutation({
    mutationFn: () =>
      applyCategorize({
        assignments: preview.assignments.map((a) => ({
          transactionId: a.transactionId,
          categoryName: a.categoryName,
          isNew: a.isNew,
          kind: a.kind,
        })),
        approvedNewCategoryNames: Object.entries(approvedMap)
          .filter(([, ok]) => ok)
          .map(([name]) => name),
      }),
    onSuccess: (data) => {
      toast.success(
        data.createdCategoriesCount > 0
          ? t("appliedWithNew", { count: data.appliedCount, created: data.createdCategoriesCount })
          : t("applied", { count: data.appliedCount })
      );
      onApplied();
    },
    onError: () => {
      toast.error(t("applyFailed"));
    },
  });

  const approvedCount = useMemo(
    () => Object.values(approvedMap).filter(Boolean).length,
    [approvedMap]
  );
  const totalProposals = preview.proposedCategories.length;

  // How many transactions will land in an existing category, in a new (approved)
  // category, or stay uncategorized.
  const stats = useMemo(() => {
    let toExisting = 0;
    let toNew = 0;
    let willStay = 0;
    for (const a of preview.assignments) {
      if (!a.isNew) toExisting++;
      else if (approvedMap[a.categoryName]) toNew++;
      else willStay++;
    }
    return { toExisting, toNew, willStay };
  }, [preview.assignments, approvedMap]);

  const sortedExistingUsage = useMemo(
    () =>
      Object.entries(preview.existingCategoryUsage)
        .map(([name, count]) => ({
          name,
          count,
          color:
            existingCategories.find((c) => c.name === name)?.color ?? "#B1AA9C",
        }))
        .sort((a, b) => b.count - a.count),
    [preview.existingCategoryUsage, existingCategories]
  );

  const setAll = (value: boolean) =>
    setApprovedMap(
      Object.fromEntries(preview.proposedCategories.map((p) => [p.name, value]))
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        initialFocus={applyRef}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3 pe-12">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { count: preview.uncategorizedCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <div className="space-y-6 pb-4">
            {sortedExistingUsage.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
                  {t("usingExisting", { count: stats.toExisting })}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {sortedExistingUsage.map((c) => (
                    <span
                      key={c.name}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="font-medium">{translateCategoryName(c.name, tCat)}</span>
                      <span className="text-muted-foreground tabular-nums">{c.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {totalProposals > 0 ? (
              <section>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
                    {t("proposedNew", { count: totalProposals })}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setAll(true)}
                      className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {t("approveAll")}
                    </button>
                    <span aria-hidden>·</span>
                    <button
                      type="button"
                      onClick={() => setAll(false)}
                      className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {t("rejectAll")}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {preview.proposedCategories.map((p) => (
                    <ProposalRow
                      key={p.name}
                      proposal={p}
                      name={translateCategoryName(p.name, tCat)}
                      countLabel={t("transactionCount", { count: p.transactionIds.length })}
                      approveLabel={t("approveLabel", { name: p.name })}
                      approved={approvedMap[p.name] ?? false}
                      onToggle={(v) =>
                        setApprovedMap((prev) => ({ ...prev, [p.name]: v }))
                      }
                    />
                  ))}
                </div>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noProposals")}</p>
            )}

            {preview.errors && preview.errors.length > 0 && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t("batchErrors", { count: preview.errors.length })}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground sm:me-auto">
            <div>
              {t("willBeCategorized", { count: stats.toExisting + stats.toNew })}
              {stats.willStay > 0 ? <> · {t("willStay", { count: stats.willStay })}</> : null}
            </div>
            {totalProposals > 0 ? (
              <div>{t("willBeCreated", { approved: approvedCount, total: totalProposals })}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              ref={applyRef}
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending ? t("applying") : t("apply")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProposalRow({
  proposal,
  name,
  countLabel,
  approveLabel,
  approved,
  onToggle,
}: {
  proposal: { name: string; transactionIds: number[]; samples: string[] };
  name: string;
  countLabel: string;
  approveLabel: string;
  approved: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border p-3 transition-colors",
        approved ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-bold tracking-tight">{name}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{countLabel}</span>
        </div>
        {/* Merchant names keep their own direction inside either UI language. */}
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {proposal.samples.map((sample, i) => (
            <span key={`${sample}-${i}`}>
              {i > 0 ? " · " : null}
              <bdi>{sample}</bdi>
            </span>
          ))}
        </div>
      </div>
      <Switch
        checked={approved}
        onCheckedChange={onToggle}
        aria-label={approveLabel}
        className="shrink-0"
      />
    </div>
  );
}
