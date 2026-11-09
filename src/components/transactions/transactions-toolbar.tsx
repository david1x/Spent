"use client";

import { useEffect, useRef, Fragment } from "react";
import { useTranslations } from "next-intl";
import { Search, Tags, Wallet, X } from "lucide-react";
import { ProviderBadge } from "@/components/setup/provider-badge";
import {
  MultiFilterOption,
  TransactionMultiFilter,
} from "./transaction-multi-filter";
import { getAccountDisplayLabel } from "./transaction-source-cell";
import {
  getCategoryDescendantIds,
  isCategoryFilterChecked,
  toggleCategoryFilterSelection,
} from "@/lib/transaction-filters";
import { translateCategoryName, translateProviderName } from "@/lib/i18n-data";
import { BANK_PROVIDERS } from "@/lib/types";
import type { Category, Integration, TransactionListAggregates } from "@/lib/types";
import type { TransactionKindFilter } from "@/lib/api";
import { cn } from "@/lib/utils";
import { accountTailText } from "@/lib/account-tail";

export type TransactionSegment = Extract<
  TransactionKindFilter,
  "all" | "spending" | "counted_income" | "not_counted"
>;

interface TransactionsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  categories: Category[];
  categoryFilter: number[];
  onCategoryFilterChange: (ids: number[]) => void;
  integrations: Integration[];
  /** "12" is a whole login, "12:4321" one card under it. */
  accountFilter: string[];
  onAccountFilterChange: (keys: string[]) => void;
  segment: TransactionSegment;
  onSegmentChange: (segment: TransactionSegment) => void;
  counts?: TransactionListAggregates["counts"];
}

export function TransactionsToolbar({
  search,
  onSearchChange,
  categories,
  categoryFilter,
  onCategoryFilterChange,
  integrations,
  accountFilter,
  onAccountFilterChange,
  segment,
  onSegmentChange,
  counts,
}: TransactionsToolbarProps) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const tBanks = useTranslations("banks");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" jumps to search, like most list UIs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const accountOptions = integrations
    .map((integration) => {
      const info = BANK_PROVIDERS.find((b) => b.id === integration.provider);
      const providerName = translateProviderName(
        integration.provider,
        info?.name ?? integration.provider,
        tBanks
      );
      const { primary } = getAccountDisplayLabel(providerName, integration.label);
      // One login can hold several cards (or bank accounts). List each so a
      // single card can be picked on its own.
      const subAccounts =
        integration.accounts.length > 1 || info?.kind === "card"
          ? integration.accounts.map((a) => ({
              key: `${integration.id}:${a.accountNumber}`,
              last4: accountTailText(a.accountNumber) ?? a.accountNumber.slice(-4),
              count: a.transactionCount,
            }))
          : [];
      return { integration, info, primary, key: String(integration.id), subAccounts };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary));

  const toggleKey = (keys: string[], key: string): string[] =>
    keys.includes(key) ? keys.filter((x) => x !== key) : [...keys, key];

  const selectedLabels = accountOptions.flatMap((o) => [
    ...(accountFilter.includes(o.key) ? [o.primary] : []),
    ...o.subAccounts
      .filter((s) => accountFilter.includes(s.key))
      .map((s) => `${o.primary} ••${s.last4}`),
  ]);
  const selectedAccounts = accountOptions.filter(
    (o) => accountFilter.includes(o.key) || o.subAccounts.some((s) => accountFilter.includes(s.key))
  );
  const singleAccount =
    selectedAccounts.length === 1 && selectedLabels.length === 1 ? selectedAccounts[0] : null;
  const accountSelectedLabel =
    selectedLabels.length === 0
      ? null
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : t("filterAccountsCount", { count: selectedLabels.length });

  const topSelectedCategories = categories.filter(
    (c) =>
      isCategoryFilterChecked(c.id, categoryFilter, categories) &&
      (c.parentId == null ||
        !isCategoryFilterChecked(c.parentId, categoryFilter, categories))
  );
  const categorySelectedLabel =
    categoryFilter.length === 0
      ? null
      : topSelectedCategories.length === 1
        ? translateCategoryName(topSelectedCategories[0]!.name, tCat)
        : t("filterCategoriesCount", {
            count: Math.max(topSelectedCategories.length, 1),
          });
  const singleCategory =
    topSelectedCategories.length === 1 ? topSelectedCategories[0] : null;

  const allCategoryIds = [
    ...new Set(
      categories.flatMap((c) => getCategoryDescendantIds(c.id, categories))
    ),
  ];

  const renderCategoryOptions = (
    parentId: number | null,
    depth: number
  ): React.ReactNode[] => {
    const items = categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) =>
        translateCategoryName(a.name, tCat).localeCompare(
          translateCategoryName(b.name, tCat)
        )
      );
    const nodes: React.ReactNode[] = [];
    for (const cat of items) {
      const hasChildren = categories.some((c) => c.parentId === cat.id);
      nodes.push(
        <MultiFilterOption
          key={cat.id}
          selected={isCategoryFilterChecked(cat.id, categoryFilter, categories)}
          onToggle={() =>
            onCategoryFilterChange(
              toggleCategoryFilterSelection(categoryFilter, cat.id, categories)
            )
          }
        >
          <div
            className={cn("flex items-center gap-2", hasChildren && "font-semibold")}
            style={{ paddingInlineStart: depth * 12 }}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            {translateCategoryName(cat.name, tCat)}
          </div>
        </MultiFilterOption>
      );
      nodes.push(...renderCategoryOptions(cat.id, depth + 1));
    }
    return nodes;
  };

  const segments: { value: TransactionSegment; label: string; count?: number }[] = [
    { value: "all", label: t("segmentAll"), count: counts?.all },
    { value: "spending", label: t("segmentSpending"), count: counts?.spending },
    { value: "counted_income", label: t("segmentIncome"), count: counts?.income },
    { value: "not_counted", label: t("segmentNotCounted"), count: counts?.notCounted },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex h-9 min-w-0 flex-[1_1_100%] items-center sm:flex-[1_1_220px] sm:max-w-80">
        <span className="sr-only">{t("searchPlaceholder")}</span>
        <Search
          className="pointer-events-none absolute start-3 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-full w-full rounded-lg border border-border bg-card ps-9 pe-9 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {search ? (
          <button
            type="button"
            onClick={() => {
              onSearchChange("");
              searchRef.current?.focus();
            }}
            className="absolute end-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("filterClearSelection")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute end-2.5 hidden rounded border border-border px-1.5 font-mono text-[10.5px] text-muted-foreground sm:inline">
            /
          </kbd>
        )}
      </label>

      {accountOptions.length > 1 ? (
        <TransactionMultiFilter
          label={t("filterAccount")}
          icon={Wallet}
          selectedLabel={accountSelectedLabel}
          selectedTitle={selectedLabels.join(", ")}
          leading={
            singleAccount?.info ? (
              <ProviderBadge
                color={singleAccount.info.color}
                name={singleAccount.primary}
                domain={singleAccount.info.domain}
                size={16}
                radius={4}
              />
            ) : undefined
          }
          selectAllLabel={t("filterSelectAll")}
          clearLabel={t("filterClearSelection")}
          removeLabel={t("filterRemove", { label: t("filterAccount") })}
          onSelectAll={() => onAccountFilterChange(accountOptions.map((o) => o.key))}
          onClear={() => onAccountFilterChange([])}
        >
          {accountOptions.map(({ integration, info, primary, key, subAccounts }) => (
            <Fragment key={key}>
            <MultiFilterOption
              selected={accountFilter.includes(key)}
              onToggle={() => onAccountFilterChange(toggleKey(accountFilter, key))}
            >
              <div className="flex min-w-0 items-center gap-2">
                {info ? (
                  <ProviderBadge
                    color={info.color}
                    name={primary}
                    domain={info.domain}
                    size={16}
                    radius={4}
                  />
                ) : null}
                <span className="truncate">{primary}</span>
              </div>
            </MultiFilterOption>
            {subAccounts.map((sub) => (
              <MultiFilterOption
                key={sub.key}
                selected={accountFilter.includes(sub.key)}
                onToggle={() => onAccountFilterChange(toggleKey(accountFilter, sub.key))}
              >
                <div className="flex min-w-0 items-center gap-2 ps-6 text-muted-foreground">
                  <span className="font-mono text-[12px] text-foreground">••{sub.last4}</span>
                  <span className="text-[11px] tabular-nums">{t("filterCardCount", { count: sub.count })}</span>
                </div>
              </MultiFilterOption>
            ))}
            </Fragment>
          ))}
        </TransactionMultiFilter>
      ) : null}

      <TransactionMultiFilter
        label={t("filterCategory")}
        icon={Tags}
        selectedLabel={categorySelectedLabel}
        selectedTitle={topSelectedCategories
          .map((c) => translateCategoryName(c.name, tCat))
          .join(", ")}
        leading={
          singleCategory ? (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: singleCategory.color }}
            />
          ) : undefined
        }
        selectAllLabel={t("filterSelectAll")}
        clearLabel={t("filterClearSelection")}
        removeLabel={t("filterRemove", { label: t("filterCategory") })}
        onSelectAll={() => onCategoryFilterChange(allCategoryIds)}
        onClear={() => onCategoryFilterChange([])}
      >
        {renderCategoryOptions(null, 0)}
      </TransactionMultiFilter>

      <div
        role="radiogroup"
        aria-label={t("segmentLabel")}
        className="flex w-full overflow-x-auto rounded-lg bg-muted p-[3px] sm:ms-auto sm:w-auto"
      >
        {segments.map((s) => {
          const active = segment === s.value;
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSegmentChange(s.value)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none",
                active
                  ? "bg-card font-medium text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
              {s.count != null ? (
                <span className="tabular-nums opacity-70">{s.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
