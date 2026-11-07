"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import {
  TRANSACTIONS_PAGE_SIZE,
  TransactionsTable,
} from "@/components/dashboard/transactions-table";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { SummaryStrip } from "./summary-strip";
import {
  TransactionsToolbar,
  type TransactionSegment,
} from "./transactions-toolbar";
import {
  getCategories,
  getTransactions,
  getTransactionsSummary,
  listIntegrations,
} from "@/lib/api";
import { expandCategoryFilterIds } from "@/lib/transaction-filters";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import { addMonths } from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import { useAmountsHidden } from "@/components/layout/amounts-toggle";
import { useBudgetPeriod } from "@/components/layout/use-budget-period";

export function TransactionsPage() {
  // Re-render everything below when "Hide amounts" flips; the formatters read it.
  useAmountsHidden();
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  // "12" is a whole login, "12:4321" one card under it.
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [segment, setSegment] = useState<TransactionSegment>("all");
  const [sortField, setSortField] = useState<TransactionSortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const { from, to, label: monthLabel } = useBudgetPeriod(selectedDate, locale);

  const allCategoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => listIntegrations(),
  });

  const allCategories = allCategoriesQuery.data ?? [];
  const expandedCategoryIds = expandCategoryFilterIds(categoryFilter, allCategories);

  const transactionsQuery = useQuery({
    queryKey: [
      "transactions",
      from,
      to,
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
        from,
        to,
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
    queryFn: () => getTransactionsSummary({ from, to }),
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
    search,
    categoryFilter,
    accountFilter,
    page,
    segment,
    sortField,
    sortOrder,
  ]);

  const changeMonth = (delta: number) => {
    setSelectedDate((d) => addMonths(d, delta));
    setPage(0);
  };

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <PeriodSelector
            label={monthLabel}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
          />
        }
      />

      <div className="space-y-4 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />

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
          integrations={integrationsQuery.data ?? []}
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

        <SummaryStrip
          aggregates={aggregates}
          loading={tableInitialLoading}
          pendingReviewCount={summaryQuery.data?.pendingReviewCount ?? 0}
        />

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
        />
      </div>
    </>
  );
}
