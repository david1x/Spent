"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import {
  TRANSACTIONS_PAGE_SIZE,
  TransactionsTable,
} from "@/components/dashboard/transactions-table";
import {
  PRESET_PERIODS,
  RangeSelector,
  type RangePreset,
} from "./range-selector";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { CategoryRequestsCard } from "@/components/sharing/category-requests";
import { ReviewBanner, SummaryStrip } from "./summary-strip";
import {
  TransactionsToolbar,
  type TransactionSegment,
} from "./transactions-toolbar";
import {
  getCategories,
  getTransactions,
  getTransactionsSummary,
  listIntegrations,
  listMovedInCards,
} from "@/lib/api";
import type { Integration, RoutedInCard } from "@/lib/types";
import { expandCategoryFilterIds } from "@/lib/transaction-filters";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import {
  formatRangeLabel,
  parseISODay,
  periodRange,
  periodsEndingWith,
  shiftPeriod,
  toISODay,
} from "@/lib/period";
import type { Locale } from "@/i18n/routing";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";
import { useBudgetPeriod } from "@/components/layout/use-budget-period";

/** Filters a link can open the page with. A search alone shows all time. */
export interface TransactionsInitialFilters {
  search?: string;
  from?: string;
  to?: string;
  categoryId?: number;
  /** Open on the review queue. */
  review?: boolean;
  segment?: TransactionSegment;
}

export function TransactionsPage({ initial }: { initial?: TransactionsInitialFilters } = {}) {
  // Re-render everything below when "Hide amounts" flips; the formatters read it.
  useAmountsHidden();
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  // The range ends with the budget period holding `anchor`; arrows move it.
  const [anchor, setAnchor] = useState(new Date());
  const linkedRange = initial?.from && initial.to ? { from: initial.from, to: initial.to } : null;
  const [preset, setPreset] = useState<RangePreset>(
    linkedRange ? "custom" : initial?.search ? "all" : "month"
  );
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(linkedRange);
  const [search, setSearch] = useState(initial?.search ?? "");
  const [categoryFilter, setCategoryFilter] = useState<number[]>(
    initial?.categoryId ? [initial.categoryId] : []
  );
  // "12" is a whole login, "12:4321" one card under it.
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // The review queue spans every date, so it ignores the range while open.
  const [reviewOnly, setReviewOnly] = useState(initial?.review === true);
  const [segment, setSegment] = useState<TransactionSegment>(initial?.segment ?? "all");
  const [sortField, setSortField] = useState<TransactionSortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const budgetPeriod = useBudgetPeriod(anchor, locale);
  const { from, to, label: rangeLabel } = resolveRange(preset, custom, budgetPeriod, locale, t("rangeAll"));

  const allCategoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => listIntegrations(),
  });
  const movedInQuery = useQuery({
    queryKey: ["movedInCards"],
    queryFn: () => listMovedInCards(),
  });
  // Cards moved in from another workspace's login are filterable like any
  // login here. The server keeps a login filter to this workspace's rows,
  // so picking one shows just the moved cards.
  const filterIntegrations = useMemo(
    () => withMovedInCards(integrationsQuery.data ?? [], movedInQuery.data ?? []),
    [integrationsQuery.data, movedInQuery.data]
  );

  const allCategories = allCategoriesQuery.data ?? [];
  const expandedCategoryIds = expandCategoryFilterIds(categoryFilter, allCategories);

  const listFrom = reviewOnly ? undefined : from;
  const listTo = reviewOnly ? undefined : to;
  const transactionsQuery = useQuery({
    queryKey: [
      "transactions",
      listFrom,
      listTo,
      reviewOnly,
      search,
      categoryFilter,
      accountFilter,
      page,
      segment,
      sortField,
      sortOrder,
    ],
    queryFn: () =>
      getTransactions({
        from: listFrom,
        to: listTo,
        review: reviewOnly || undefined,
        search: search.trim() || undefined,
        categoryIds: expandedCategoryIds,
        accounts: accountFilter.length > 0 ? accountFilter : undefined,
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: page * TRANSACTIONS_PAGE_SIZE,
        kind: segment,
        sort: sortField,
        order: sortOrder,
        aggregates: true,
      }),
    placeholderData: keepPreviousData,
  });

  // Only for the review queue size, which is workspace-wide.
  const summaryQuery = useQuery({
    queryKey: ["transactions-summary", from, to],
    queryFn: () =>
      getTransactionsSummary({ from: from ?? "1900-01-01", to: to ?? toISODay(new Date()) }),
  });

  const aggregates = transactionsQuery.data?.aggregates;
  const tableInitialLoading =
    transactionsQuery.isPending && transactionsQuery.data === undefined;
  const hasFilters =
    search.trim().length > 0 ||
    categoryFilter.length > 0 ||
    accountFilter.length > 0 ||
    segment !== "all";

  const selectionKey = JSON.stringify([
    from,
    to,
    reviewOnly,
    search,
    categoryFilter,
    accountFilter,
    page,
    segment,
    sortField,
    sortOrder,
  ]);

  const step = (direction: 1 | -1) => {
    setPage(0);
    if (preset === "custom" && custom) {
      setCustom(shiftDays(custom, direction));
      return;
    }
    if (preset === "all" || preset === "custom") return;
    const n = PRESET_PERIODS[preset] * direction;
    setAnchor(shiftPeriod(budgetPeriod.period, n, budgetPeriod.startDay).start);
  };

  const showMerchantEverywhere = (description: string) => {
    setSearch(description);
    setCategoryFilter([]);
    setAccountFilter([]);
    setSegment("all");
    setPreset("all");
    setPage(0);
  };

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <RangeSelector
            preset={preset}
            label={rangeLabel}
            from={from}
            to={to}
            onPresetChange={(next) => {
              setPreset(next);
              setPage(0);
            }}
            onCustomApply={(f, tTo) => {
              setCustom({ from: f, to: tTo });
              setPreset("custom");
              setPage(0);
            }}
            onPrev={preset === "all" ? undefined : () => step(-1)}
            onNext={preset === "all" ? undefined : () => step(1)}
          />
        }
      />

      <div className="space-y-4 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        <CategoryRequestsCard />

        <TransactionsToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          categories={allCategories}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={(ids) => {
            setCategoryFilter(ids);
            setPage(0);
          }}
          integrations={filterIntegrations}
          accountFilter={accountFilter}
          onAccountFilterChange={(ids) => {
            setAccountFilter(ids);
            setPage(0);
          }}
          segment={segment}
          onSegmentChange={(next) => {
            setSegment(next);
            setPage(0);
          }}
          counts={aggregates?.counts}
        />

        {reviewOnly ? (
          <ReviewBanner
            count={summaryQuery.data?.pendingReviewCount ?? transactionsQuery.data?.total ?? 0}
            uncategorizedCount={summaryQuery.data?.uncategorizedCount ?? 0}
            onDone={() => {
              setReviewOnly(false);
              setPage(0);
            }}
          />
        ) : (
          <SummaryStrip
            aggregates={aggregates}
            loading={tableInitialLoading}
            pendingReviewCount={summaryQuery.data?.pendingReviewCount ?? 0}
            uncategorizedCount={summaryQuery.data?.uncategorizedCount ?? 0}
            onOpenReview={() => {
              setReviewOnly(true);
              setPage(0);
            }}
          />
        )}

        <TransactionsTable
          transactions={transactionsQuery.data?.transactions ?? []}
          total={transactionsQuery.data?.total ?? 0}
          days={aggregates?.days}
          loading={tableInitialLoading}
          isFetching={transactionsQuery.isFetching}
          hasFilters={hasFilters}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={(field) => {
            const next = nextSortState(sortField, sortOrder, field);
            setSortField(next.field);
            setSortOrder(next.order);
            setPage(0);
          }}
          page={page}
          onPageChange={setPage}
          selectionKey={selectionKey}
          onShowMerchantEverywhere={showMerchantEverywhere}
        />
      </div>
    </>
  );
}

/** The from/to and label for the chosen range. All time leaves both open. */
function resolveRange(
  preset: RangePreset,
  custom: { from: string; to: string } | null,
  budget: ReturnType<typeof useBudgetPeriod>,
  locale: Locale,
  allTimeLabel: string
): { from?: string; to?: string; label: string } {
  if (preset === "all") return { label: allTimeLabel };
  if (preset === "custom" && custom) {
    const start = parseISODay(custom.from);
    const end = parseISODay(custom.to);
    if (start && end) return { ...custom, label: formatRangeLabel(start, end, locale) };
  }
  const n = preset === "custom" ? 1 : PRESET_PERIODS[preset];
  if (n === 1) return { from: budget.from, to: budget.to, label: budget.label };
  const span = periodsEndingWith(budget.period, n, budget.startDay);
  return { ...periodRange(span), label: formatRangeLabel(span.start, span.end, locale) };
}

/** Moves a custom range by its own length, so the arrows page through it. */
function shiftDays(range: { from: string; to: string }, direction: 1 | -1) {
  const start = parseISODay(range.from);
  const end = parseISODay(range.to);
  if (!start || !end) return range;
  // Whole calendar months step by months, so Jan to Mar is followed by Apr to Jun.
  const dayAfterEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  if (start.getDate() === 1 && dayAfterEnd.getDate() === 1) {
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
    const shift = months * direction;
    return {
      from: toISODay(new Date(start.getFullYear(), start.getMonth() + shift, 1)),
      to: toISODay(new Date(end.getFullYear(), end.getMonth() + shift + 1, 0)),
    };
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const move = (d: Date) =>
    toISODay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days * direction));
  return { from: move(start), to: move(end) };
}

/**
 * Adds an account-filter entry per login that has cards moved into this
 * workspace. Only the fields the filter reads matter; the rest are neutral.
 */
function withMovedInCards(integrations: Integration[], movedIn: RoutedInCard[]): Integration[] {
  const own = new Set(integrations.map((i) => i.id));
  const extra = new Map<number, Integration>();
  for (const m of movedIn) {
    if (own.has(m.credentialId)) continue;
    const entry = extra.get(m.credentialId) ?? {
      id: m.credentialId,
      provider: m.provider,
      label: m.label,
      createdAt: "",
      updatedAt: "",
      lastSyncAt: null,
      transactionCount: 0,
      requiresManualTwoFactor: false,
      hasTwoFactorToken: false,
      matchedBillCount: 0,
      accounts: [],
      linkedCardCount: 0,
    };
    entry.accounts.push({
      accountNumber: m.card.accountNumber,
      transactionCount: m.card.purchaseCount,
    });
    entry.transactionCount += m.card.purchaseCount;
    extra.set(m.credentialId, entry);
  }
  return [...integrations, ...extra.values()];
}
