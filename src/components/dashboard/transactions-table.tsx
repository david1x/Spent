"use client";

import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  CalendarClock,
  Check,
  Clock,
  Eye,
  EyeOff,
  History,
  Minus,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Tag,
  Undo2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { normalizeCurrency } from "@/lib/currency";
import {
  approveTransactionCategory,
  getCategories,
  setTransactionExcluded,
  setTransactionKind,
  trackAsSubscription,
  updateTransactionCategory,
  suggestCategory,
  updateTransactionText,
} from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import { AccountMark } from "@/components/transactions/transaction-source-cell";
import {
  CategoryChip,
  type CategoryChipVariant,
} from "@/components/transactions/category-chip";
import {
  SortableTableHead,
  SortButton,
  TABLE_HEAD_CLASS,
} from "@/components/transactions/sortable-table-head";
import { INCOME_INK } from "@/components/transactions/summary-strip";
import { PaymentHistorySheet } from "@/components/transactions/payment-history-sheet";
import {
  TransactionTextDialog,
  isForeignPurchase,
  type TransactionTextValues,
} from "@/components/transactions/transaction-text-dialog";
import { isRenamed, transactionName } from "@/lib/transaction-name";
import { BudgetEditDialog } from "@/components/budget/budget-edit-popover";
import { useAccess } from "@/components/access-provider";
import {
  CATEGORY_REQUESTS_KEY,
  useCategoryRequestActions,
  useCategoryRequests,
} from "@/components/sharing/category-requests";
import type { RecurringCadence } from "@/lib/insights-types";

/** Frequencies offered when tracking a transaction as a subscription, most common first. */
const TRACK_CADENCES: RecurringCadence[] = ["monthly", "annual", "bimonthly", "quarterly", "weekly"];
import type { SortOrder, TransactionSortField } from "@/lib/transaction-sort";
import { cn } from "@/lib/utils";
import type {
  Category,
  CategoryRequest,
  TransactionListAggregates,
  TransactionWithCategory,
} from "@/lib/types";
import type { Locale } from "@/i18n/routing";

type Kind = "expense" | "income" | "transfer";
type NotCountedReason = "transfer" | "excluded" | "category";
type Translator = ReturnType<typeof useTranslations<"transactions">>;
type CategoryTranslator = ReturnType<typeof useTranslations<"categoriesSeeded">>;

interface TransactionsTableProps {
  transactions: TransactionWithCategory[];
  total: number;
  /** Per-date totals from the list API; day headers fall back to the page rows. */
  days?: TransactionListAggregates["days"];
  loading: boolean;
  isFetching?: boolean;
  hasFilters: boolean;
  page: number;
  onPageChange: (page: number) => void;
  sortField: TransactionSortField;
  sortOrder: SortOrder;
  onSortChange: (field: TransactionSortField) => void;
  /** Selection is dropped whenever this changes (new page, filters or month). */
  selectionKey: string;
  /** "See all" in the history sheet: list this merchant across all time. */
  onShowMerchantEverywhere?: (description: string) => void;
}

export const TRANSACTIONS_PAGE_SIZE = 50;

function bcp47(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-IL";
}

/** Local calendar day for a stored UTC instant. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function notCountedReason(txn: TransactionWithCategory): NotCountedReason | null {
  if (txn.isExcluded) return "excluded";
  if (txn.kind === "transfer") return "transfer";
  if (txn.isCounted === false) return "category";
  return null;
}

interface DayTotals {
  spent: number;
  income: number;
  notCounted: number;
}

interface DayGroup {
  key: string;
  rows: TransactionWithCategory[];
}

function groupByDay(rows: TransactionWithCategory[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const key = localDayKey(row.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

function totalsFromRows(rows: TransactionWithCategory[]): DayTotals {
  const totals: DayTotals = { spent: 0, income: 0, notCounted: 0 };
  for (const r of rows) {
    if (notCountedReason(r)) {
      if (r.chargedAmount < 0) totals.notCounted += -r.chargedAmount;
    } else if (r.chargedAmount < 0) totals.spent += -r.chargedAmount;
    else totals.income += r.chargedAmount;
  }
  return totals;
}

export function TransactionsTable({
  transactions,
  total,
  days,
  loading,
  isFetching = false,
  hasFilters,
  page,
  onPageChange,
  sortField,
  sortOrder,
  onSortChange,
  selectionKey,
  onShowMerchantEverywhere,
}: TransactionsTableProps) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const {
    actions,
    updatingId,
    categoriesFor,
    invalidateAll,
    historyId,
    setHistoryId,
    editingTxn,
    setEditingTxn,
    saveText,
    budgetCategory,
    setBudgetCategory,
    expenseCategories,
    incomeCategories,
  } = useTransactionRowActions();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selection, setSelection] = useState<{ key: string; ids: number[] }>({
    key: selectionKey,
    ids: [],
  });
  const totalPages = Math.ceil(total / TRANSACTIONS_PAGE_SIZE);
  const grouped = sortField === "date";


  const selectedIdSet = new Set(selection.key === selectionKey ? selection.ids : []);
  const selectedRows = transactions.filter((r) => selectedIdSet.has(r.id));
  const allOnPageSelected =
    transactions.length > 0 && selectedRows.length === transactions.length;

  const setSelectedIds = (ids: number[]) => setSelection({ key: selectionKey, ids });
  const toggleRow = (id: number) =>
    setSelectedIds(
      selectedIdSet.has(id)
        ? [...selectedIdSet].filter((x) => x !== id)
        : [...selectedIdSet, id]
    );
  const toggleAll = () =>
    setSelectedIds(allOnPageSelected ? [] : transactions.map((r) => r.id));

  const runBulk = async (
    rows: TransactionWithCategory[],
    action: (txn: TransactionWithCategory) => Promise<unknown>
  ) => {
    if (rows.length === 0) return;
    setBulkBusy(true);
    try {
      // No bulk endpoint exists; the single-item APIs are cheap local calls.
      await Promise.all(rows.map(action));
      toast.success(t("bulkUpdatedToast", { count: rows.length }));
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("actionFailed"));
    } finally {
      invalidateAll();
      setBulkBusy(false);
    }
  };

  const dayTotalsByKey = new Map<string, DayTotals>();
  if (days) {
    for (const d of days) {
      const key = localDayKey(d.date);
      const prev = dayTotalsByKey.get(key) ?? { spent: 0, income: 0, notCounted: 0 };
      dayTotalsByKey.set(key, {
        spent: prev.spent + d.spent,
        income: prev.income + d.income,
        notCounted: prev.notCounted + d.notCounted,
      });
    }
  }

  const groups: DayGroup[] = grouped
    ? groupByDay(transactions)
    : [{ key: "all", rows: transactions }];

  const rowProps = {
    t,
    tCat,
    locale,
    actions,
    categoriesFor,
    updatingId,
  };

  const sortProps = {
    activeField: sortField,
    activeOrder: sortOrder,
    onSort: onSortChange,
    sortAscLabel: t("sortAsc"),
    sortDescLabel: t("sortDesc"),
  };

  const colCount = grouped ? 6 : 7;

  return (
    <section className="rounded-2xl border border-border bg-card">
      {loading ? (
        <div className="space-y-3 p-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
          {hasFilters ? t("emptyWithFilters") : t("emptyNoData")}
        </div>
      ) : (
        <div
          className={cn(
            "transition-opacity duration-200",
            isFetching && "opacity-60"
          )}
        >
          {/* Desktop and tablet: a real table. */}
          <div className="hidden overflow-x-auto rounded-t-2xl md:block">
            <table className="w-full min-w-[600px] border-collapse text-[13.5px] xl:min-w-[760px]">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={cn(TABLE_HEAD_CLASS, "w-10 pe-0")}>
                    {actions.readOnly ? null : (
                      <RowCheckbox
                        checked={allOnPageSelected}
                        indeterminate={selectedRows.length > 0 && !allOnPageSelected}
                        onToggle={toggleAll}
                        label={t("selectAllRows")}
                      />
                    )}
                  </th>
                  {grouped ? (
                    <th
                      scope="col"
                      aria-sort={sortOrder === "asc" ? "ascending" : "descending"}
                      className={TABLE_HEAD_CLASS}
                    >
                      <span className="inline-flex items-center gap-3">
                        <SortButton label={t("headerDate")} field="date" {...sortProps} />
                        <span aria-hidden className="text-border">
                          /
                        </span>
                        <SortButton
                          label={t("headerMerchant")}
                          field="description"
                          {...sortProps}
                        />
                      </span>
                    </th>
                  ) : (
                    <>
                      <SortableTableHead
                        label={t("headerDate")}
                        field="date"
                        className="w-24"
                        {...sortProps}
                      />
                      <SortableTableHead
                        label={t("headerMerchant")}
                        field="description"
                        {...sortProps}
                      />
                    </>
                  )}
                  <SortableTableHead
                    label={t("headerCategory")}
                    field="category_name"
                    className="w-[210px]"
                    {...sortProps}
                  />
                  <SortableTableHead
                    label={t("headerAccount")}
                    field="account"
                    className="hidden w-[190px] xl:table-cell"
                    {...sortProps}
                  />
                  <SortableTableHead
                    label={t("headerAmount")}
                    field="charged_amount"
                    align="end"
                    className="w-[130px]"
                    {...sortProps}
                  />
                  <th scope="col" className={cn(TABLE_HEAD_CLASS, "w-[116px]")}>
                    <span className="sr-only">{t("headerActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    {grouped ? (
                      <tr className="border-b border-border bg-muted/45">
                        <td
                          colSpan={colCount - 2}
                          className="px-3.5 py-[7px] text-xs text-muted-foreground"
                        >
                          <DayLabel dayKey={group.key} locale={locale} t={t} />
                        </td>
                        <td
                          colSpan={2}
                          className="px-3.5 py-[7px] text-end text-xs tabular-nums text-muted-foreground"
                        >
                          <DayTotalText
                            totals={
                              dayTotalsByKey.get(group.key) ?? totalsFromRows(group.rows)
                            }
                            locale={locale}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {group.rows.map((txn) => (
                      <DesktopRow
                        key={txn.id}
                        txn={txn}
                        showDate={!grouped}
                        selected={selectedIdSet.has(txn.id)}
                        onToggleSelected={() => toggleRow(txn.id)}
                        {...rowProps}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: two-line rows. */}
          <ul className="md:hidden">
            {groups.map((group) => (
              <Fragment key={group.key}>
                {grouped ? (
                  <li className="flex items-center justify-between gap-3 border-b border-border bg-muted/45 px-4 py-2 text-xs text-muted-foreground first:rounded-t-2xl">
                    <span className="min-w-0 truncate">
                      <DayLabel dayKey={group.key} locale={locale} t={t} />
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <DayTotalText
                        totals={dayTotalsByKey.get(group.key) ?? totalsFromRows(group.rows)}
                        locale={locale}
                      />
                    </span>
                  </li>
                ) : null}
                {group.rows.map((txn) => (
                  <MobileRow
                    key={txn.id}
                    txn={txn}
                    showDate={!grouped}
                    selected={selectedIdSet.has(txn.id)}
                    onToggleSelected={() => toggleRow(txn.id)}
                    {...rowProps}
                  />
                ))}
              </Fragment>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("paginationRange", {
                  from: page * TRANSACTIONS_PAGE_SIZE + 1,
                  to: Math.min((page + 1) * TRANSACTIONS_PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page === 0}
                >
                  {t("previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                >
                  {t("next")}
                </Button>
              </div>
            </div>
          )}

          {selectedRows.length > 0 ? (
            <BulkBar
              rows={selectedRows}
              busy={bulkBusy}
              locale={locale}
              t={t}
              tCat={tCat}
              expenseCategories={expenseCategories}
              incomeCategories={incomeCategories}
              onSetCategory={(categoryId) =>
                runBulk(selectedRows, (r) => updateTransactionCategory(r.id, categoryId))
              }
              onSetExcluded={(excluded) =>
                runBulk(
                  selectedRows.filter((r) => r.isExcluded !== excluded),
                  (r) => setTransactionExcluded(r.id, excluded)
                )
              }
              onClear={() => setSelectedIds([])}
            />
          ) : null}
        </div>
      )}
      <PaymentHistorySheet
        transactionId={historyId}
        onClose={() => setHistoryId(null)}
        onShowAll={onShowMerchantEverywhere}
      />
      <TransactionTextDialog txn={editingTxn} onClose={() => setEditingTxn(null)} onSave={saveText} />
      <BudgetEditDialog category={budgetCategory} onClose={() => setBudgetCategory(null)} />
    </section>
  );
}

/**
 * What a transaction row can do (change category, approve, count or not,
 * kind, history, subscriptions), shared by the Transactions page and the
 * budget sheet. Changing a category offers, in a toast, to apply it to the
 * merchant's other transactions too.
 */
export function useTransactionRowActions() {
  const t = useTranslations("transactions");
  const tShare = useTranslations("sharing.requests");
  const tCat = useTranslations("categoriesSeeded");
  const queryClient = useQueryClient();
  const { readOnly, ownerName } = useAccess();
  const { byTransaction } = useCategoryRequests();
  const requestActions = useCategoryRequestActions();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);

  const incomeCategoriesQuery = useQuery({
    queryKey: ["categories", "income"],
    queryFn: () => getCategories("income"),
  });
  const expenseCategoriesQuery = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => getCategories("expense"),
  });
  const incomeCategories = incomeCategoriesQuery.data ?? [];
  const expenseCategories = expenseCategoriesQuery.data ?? [];

  const categoriesFor = (txn: TransactionWithCategory): Category[] =>
    txn.chargedAmount > 0 ? incomeCategories : expenseCategories;
  const categoryNameFor = (id: number): string => {
    const cat = [...expenseCategories, ...incomeCategories].find((c) => c.id === id);
    return cat ? translateCategoryName(cat.name, tCat) : "";
  };

  const invalidateAll = () => {
    for (const key of [
      "transactions",
      "summary",
      "transactions-summary",
      "home",
      "categories",
      "excluded-merchants",
      "category-detail",
      "insights",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const runRowAction = async (txnId: number, action: () => Promise<unknown>) => {
    setUpdatingId(txnId);
    try {
      await action();
      invalidateAll();
      return true;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("actionFailed"));
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const [editingTxn, setEditingTxn] = useState<TransactionWithCategory | null>(null);
  const [budgetCategory, setBudgetCategory] = useState<{ id: number; name: string } | null>(null);

  /** Saves a name and note, then offers the name to the merchant's other rows. */
  const saveText = async (txn: TransactionWithCategory, values: TransactionTextValues): Promise<boolean> => {
    let others = 0;
    const ok = await runRowAction(txn.id, async () => {
      const res = await updateTransactionText(txn.id, values);
      others = res.sameMerchantCount ?? 0;
    });
    if (!ok) return false;
    const named = values.displayName;
    if (!named || named === (txn.displayName ?? null) || others === 0) {
      toast.success(t("renameSaved"));
      return true;
    }
    toast(t("renameApplyPrompt", { count: others, name: named }), {
      duration: 10_000,
      action: {
        label: t("renameApplyAction", { count: others }),
        onClick: () =>
          void runRowAction(txn.id, async () => {
            const res = await updateTransactionText(txn.id, { displayName: named }, true);
            toast.success(t("renameApplyDone", { count: res.applied, name: named }));
          }),
      },
    });
    return true;
  };

  const actions: RowActions = {
    readOnly,
    pendingFor: (txn) => byTransaction.get(txn.id),
    decideRequest: (req, decision) => requestActions.decide.mutate({ ids: [req.id], decision }),
    withdrawRequest: (req) => requestActions.withdraw.mutate(req.id),
    openHistory: (txn) => setHistoryId(txn.id),
    editText: (txn) => setEditingTxn(txn),
    editBudget: (txn) =>
      txn.categoryId != null &&
      setBudgetCategory({ id: txn.categoryId, name: categoryNameFor(txn.categoryId) }),
    trackSubscription: (txn, cadence) =>
      void trackAsSubscription(txn.id, cadence)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["insights"] });
          toast.success(t("trackedToast", { merchant: transactionName(txn), cadence: t(`trackCadence.${cadence}`) }));
        })
        .catch(() => toast.error(t("actionFailed"))),
    changeCategory: (txn, categoryId) =>
      void (async () => {
        if (readOnly) {
          // A viewer can't change it; the owner gets a suggestion to approve.
          const ok = await runRowAction(txn.id, () => suggestCategory(txn.id, categoryId));
          if (ok) {
            void queryClient.invalidateQueries({ queryKey: CATEGORY_REQUESTS_KEY });
            toast.success(
              tShare("sentToast", { category: categoryNameFor(categoryId), owner: ownerName ?? tShare("theOwner") })
            );
          }
          return;
        }
        let others = 0;
        const ok = await runRowAction(txn.id, async () => {
          const res = await updateTransactionCategory(txn.id, categoryId);
          others = res.sameMerchantCount ?? 0;
        });
        if (!ok || others === 0) return;
        const name = categoryNameFor(categoryId);
        toast(t("applyToMerchantPrompt", { count: others, merchant: transactionName(txn), category: name }), {
          duration: 10_000,
          action: {
            label: t("applyToMerchantAction", { count: others }),
            onClick: () =>
              void runRowAction(txn.id, async () => {
                const res = await updateTransactionCategory(txn.id, categoryId, true);
                toast.success(t("applyToMerchantDone", { count: res.applied, merchant: transactionName(txn) }));
              }),
          },
        });
      })(),
    approve: (txn) =>
      void runRowAction(txn.id, () => approveTransactionCategory(txn.id)),
    changeKind: (txn, kind) =>
      void runRowAction(txn.id, () => setTransactionKind(txn.id, kind)),
    toggleExcluded: async (txn, alwaysForMerchant = false) => {
      const next = !txn.isExcluded;
      const ok = await runRowAction(txn.id, () =>
        setTransactionExcluded(txn.id, next, alwaysForMerchant)
      );
      if (!ok) return;
      if (next) {
        toast.success(
          alwaysForMerchant
            ? t("excludeMerchantToast", { merchant: transactionName(txn) })
            : t("excludeToast")
        );
      } else {
        toast.success(t("includeToast"));
      }
    },
  };

  return {
    actions,
    updatingId,
    categoriesFor,
    invalidateAll,
    historyId,
    setHistoryId,
    editingTxn,
    setEditingTxn,
    saveText,
    budgetCategory,
    setBudgetCategory,
    expenseCategories,
    incomeCategories,
  };
}

export type TransactionRowController = ReturnType<typeof useTransactionRowActions>;

/**
 * A compact, editable list of transactions (the phone-style rows), for side
 * sheets. Same menus and toasts as the Transactions page.
 */
export function TransactionRowList({
  transactions,
  controller,
}: {
  transactions: TransactionWithCategory[];
  controller: TransactionRowController;
}) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  return (
    <>
      <ul>
        {transactions.map((txn) => (
          <MobileRow
            key={txn.id}
            txn={txn}
            showDate
            selected={false}
            onToggleSelected={() => undefined}
            selectable={false}
            t={t}
            tCat={tCat}
            locale={locale}
            actions={controller.actions}
            categoriesFor={controller.categoriesFor}
            updatingId={controller.updatingId}
          />
        ))}
      </ul>
      <PaymentHistorySheet transactionId={controller.historyId} onClose={() => controller.setHistoryId(null)} />
      <TransactionTextDialog
        txn={controller.editingTxn}
        onClose={() => controller.setEditingTxn(null)}
        onSave={controller.saveText}
      />
      <BudgetEditDialog category={controller.budgetCategory} onClose={() => controller.setBudgetCategory(null)} />
    </>
  );
}

interface RowActions {
  /** A viewer: no edits, and a category pick becomes a suggestion for the owner. */
  readOnly: boolean;
  pendingFor: (txn: TransactionWithCategory) => CategoryRequest | undefined;
  decideRequest: (req: CategoryRequest, decision: "approve" | "decline") => void;
  withdrawRequest: (req: CategoryRequest) => void;
  openHistory: (txn: TransactionWithCategory) => void;
  editText: (txn: TransactionWithCategory) => void;
  editBudget: (txn: TransactionWithCategory) => void;
  trackSubscription: (txn: TransactionWithCategory, cadence: RecurringCadence) => void;
  changeCategory: (txn: TransactionWithCategory, categoryId: number) => void;
  approve: (txn: TransactionWithCategory) => void;
  changeKind: (txn: TransactionWithCategory, kind: Kind) => void;
  toggleExcluded: (txn: TransactionWithCategory, alwaysForMerchant?: boolean) => Promise<void>;
}

interface RowProps {
  txn: TransactionWithCategory;
  showDate: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  t: Translator;
  tCat: CategoryTranslator;
  locale: Locale;
  actions: RowActions;
  categoriesFor: (txn: TransactionWithCategory) => Category[];
  updatingId: number | null;
  /** False where there's nothing to select rows for (a side sheet). */
  selectable?: boolean;
}

function DesktopRow({
  txn,
  showDate,
  selected,
  onToggleSelected,
  t,
  tCat,
  locale,
  actions,
  categoriesFor,
  updatingId,
}: RowProps) {
  const reason = notCountedReason(txn);
  const busy = updatingId === txn.id;
  const canToggleCount = reason === null || reason === "excluded";

  return (
    <tr
      className={cn(
        "group border-b border-border transition-colors last:border-b-0",
        selected
          ? "bg-primary/[0.07]"
          : "hover:bg-muted/40 has-[[aria-expanded=true]]:bg-muted/40",
        busy && "opacity-60"
      )}
    >
      <td className="w-10 py-2.5 ps-3.5 pe-0 align-middle">
        {actions.readOnly ? null : (
          <RowCheckbox
            checked={selected}
            onToggle={onToggleSelected}
            label={t("selectRow", { merchant: transactionName(txn) })}
          />
        )}
      </td>
      {showDate ? (
        <td className="px-3.5 py-2.5 align-middle text-[13px] tabular-nums whitespace-nowrap text-muted-foreground">
          {new Date(txn.date).toLocaleDateString(bcp47(locale), {
            day: "numeric",
            month: "short",
          })}
        </td>
      ) : null}
      <td className="max-w-0 px-3.5 py-2.5 align-middle">
        <button
          type="button"
          onClick={() => actions.openHistory(txn)}
          className="-mx-1.5 -my-1 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-start outline-none hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50"
          title={t("historyOpen")}
        >
          <MerchantText txn={txn} t={t} muted={reason !== null} />
        </button>
        {/* Narrower screens drop the Account column; the bank mark moves here. */}
        <AccountMark
          provider={txn.provider}
          accountLabel={txn.accountLabel}
          accountNumber={txn.accountNumber}
          size="sm"
          className="mt-0.5 text-xs text-muted-foreground xl:hidden"
        />
      </td>
      <td className="px-3.5 py-2.5 align-middle">
        <div className="flex flex-wrap items-center gap-1">
          <CategoryMenu
            txn={txn}
            t={t}
            tCat={tCat}
            categories={categoriesFor(txn)}
            actions={actions}
            disabled={busy}
            triggerClassName="max-w-[196px] rounded-full"
          >
            <RowCategoryChip txn={txn} reason={reason} t={t} tCat={tCat} />
          </CategoryMenu>
          {txn.needsReview && txn.categoryName && !actions.readOnly ? (
            <ApproveButton txn={txn} t={t} actions={actions} disabled={busy} />
          ) : null}
          <PendingRequestPill txn={txn} actions={actions} tCat={tCat} />
        </div>
      </td>
      <td
        className={cn(
          "hidden max-w-[190px] px-3.5 py-2.5 align-middle text-[13px] xl:table-cell",
          reason !== null && "text-muted-foreground"
        )}
      >
        <AccountMark
          provider={txn.provider}
          accountLabel={txn.accountLabel}
          accountNumber={txn.accountNumber}
        />
      </td>
      <td className="px-3.5 py-2.5 text-end align-middle">
        <AmountText txn={txn} muted={reason !== null} locale={locale} />
      </td>
      <td className="px-2 py-2.5 text-end align-middle whitespace-nowrap">
        <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
          <CategoryMenu
            txn={txn}
            t={t}
            tCat={tCat}
            categories={categoriesFor(txn)}
            actions={actions}
            disabled={busy}
            triggerClassName={ICON_BUTTON_CLASS}
            triggerLabel={t("actionChangeCategory")}
          >
            <Tag className="h-4 w-4" />
          </CategoryMenu>
          {canToggleCount && !actions.readOnly ? (
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              disabled={busy}
              onClick={() => void actions.toggleExcluded(txn)}
              aria-label={txn.isExcluded ? t("actionCountAgain") : t("actionDontCount")}
              title={txn.isExcluded ? t("actionCountAgain") : t("actionDontCount")}
            >
              {txn.isExcluded ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          ) : null}
          <RowMoreMenu
            txn={txn}
            t={t}
            tCat={tCat}
            categories={categoriesFor(txn)}
            actions={actions}
            disabled={busy}
            includeCategory={false}
          />
        </div>
      </td>
    </tr>
  );
}

function MobileRow({
  txn,
  showDate,
  selected,
  onToggleSelected,
  t,
  tCat,
  locale,
  actions,
  categoriesFor,
  updatingId,
  selectable = true,
}: RowProps) {
  const reason = notCountedReason(txn);
  const busy = updatingId === txn.id;

  return (
    <li
      className={cn(
        "flex gap-3 border-b border-border px-4 py-3 last:border-b-0",
        selected && "bg-primary/[0.07]",
        busy && "opacity-60"
      )}
    >
      {selectable && !actions.readOnly ? (
        <div className="pt-0.5">
          <RowCheckbox
            checked={selected}
            onToggle={onToggleSelected}
            label={t("selectRow", { merchant: transactionName(txn) })}
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <button
            type="button"
            onClick={() => actions.openHistory(txn)}
            className={cn(
              "min-w-0 truncate rounded-sm text-start text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              reason !== null && "text-muted-foreground"
            )}
          >
            <bdi>{transactionName(txn)}</bdi>
          </button>
          <AmountText txn={txn} muted={reason !== null} locale={locale} compact />
        </div>
        {txn.note || isRenamed(txn) ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={txn.note ?? txn.description}>
            <bdi>{txn.note ?? txn.description}</bdi>
          </div>
        ) : null}
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <CategoryMenu
            txn={txn}
            t={t}
            tCat={tCat}
            categories={categoriesFor(txn)}
            actions={actions}
            disabled={busy}
            triggerClassName="min-w-0 max-w-[55%] shrink rounded-full"
          >
            <RowCategoryChip txn={txn} reason={reason} t={t} tCat={tCat} />
          </CategoryMenu>
          {txn.needsReview && txn.categoryName && !actions.readOnly ? (
            <ApproveButton txn={txn} t={t} actions={actions} disabled={busy} />
          ) : null}
          <PendingRequestPill txn={txn} actions={actions} tCat={tCat} compact />
          <AccountMark
            provider={txn.provider}
            accountLabel={txn.accountLabel}
            accountNumber={txn.accountNumber}
            size="sm"
            hideLabel
            className="text-xs text-muted-foreground"
          />
          {showDate ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(txn.date).toLocaleDateString(bcp47(locale), {
                day: "numeric",
                month: "short",
              })}
            </span>
          ) : null}
          <div className="ms-auto shrink-0">
            <RowMoreMenu
              txn={txn}
              t={t}
              tCat={tCat}
              categories={categoriesFor(txn)}
              actions={actions}
              disabled={busy}
              includeCategory
            />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Keeps the AI's category and takes the row out of the review queue. */
function ApproveButton({
  txn,
  t,
  actions,
  disabled,
}: {
  txn: TransactionWithCategory;
  t: Translator;
  actions: RowActions;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => actions.approve(txn)}
      disabled={disabled}
      aria-label={t("rowApproveLabel", { merchant: transactionName(txn) })}
      title={t("rowApproveTooltip")}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      <Check className="h-3.5 w-3.5" style={{ color: INCOME_INK }} />
      {t("rowLooksRight")}
    </button>
  );
}

const ICON_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-expanded:bg-card aria-expanded:text-foreground";

function MerchantText({
  txn,
  t,
  muted,
}: {
  txn: TransactionWithCategory;
  t: Translator;
  muted: boolean;
}) {
  const details: string[] = [];
  if (txn.note) details.push(txn.note);
  if (isRenamed(txn)) details.push(txn.description);
  if (txn.memo && txn.memo.trim() !== "") details.push(txn.memo.trim());
  if (txn.type === "installments" && txn.installmentNumber && txn.installmentTotal) {
    details.push(
      t("rowInstallment", { n: txn.installmentNumber, total: txn.installmentTotal })
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn("truncate font-medium", muted && "text-muted-foreground")}
        title={txn.description}
      >
        <bdi>{transactionName(txn)}</bdi>
      </span>
      {details.length > 0 ? (
        <span
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={details.join(" · ")}
        >
          <bdi>{details.join(" · ")}</bdi>
        </span>
      ) : null}
    </div>
  );
}

function AmountText({
  txn,
  muted,
  locale,
  compact = false,
}: {
  txn: TransactionWithCategory;
  muted: boolean;
  locale: Locale;
  compact?: boolean;
}) {
  const t = useTranslations("transactions");
  const isIncome = txn.chargedAmount > 0;
  const estimated = txn.chargedEstimated === true;
  const foreign =
    txn.originalCurrency &&
    normalizeCurrency(txn.originalCurrency) !== "ILS" &&
    txn.originalAmount !== txn.chargedAmount
      ? formatCurrency(txn.originalAmount, txn.originalCurrency, locale)
      : null;
  return (
    <span className="inline-flex shrink-0 flex-col items-end">
      <span
        className={cn(
          "tabular-nums whitespace-nowrap",
          compact ? "text-sm" : "text-[13.5px]",
          muted ? "font-normal text-muted-foreground" : "font-medium text-foreground"
        )}
        style={!muted && isIncome ? { color: INCOME_INK } : undefined}
        title={estimated ? t("amountEstimatedHint") : txn.chargedByUser ? t("amountSetByYouHint") : undefined}
      >
        <bdi>
          {estimated ? "≈ " : ""}
          {isIncome ? "+" : ""}
          {formatCurrency(txn.chargedAmount, "ILS", locale)}
        </bdi>
      </span>
      {foreign && !compact ? (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          <bdi>{foreign}</bdi>
        </span>
      ) : null}
    </span>
  );
}

function RowCategoryChip({
  txn,
  reason,
  t,
  tCat,
}: {
  txn: TransactionWithCategory;
  reason: NotCountedReason | null;
  t: Translator;
  tCat: CategoryTranslator;
}) {
  const name = txn.categoryName ? translateCategoryName(txn.categoryName, tCat) : null;

  if (reason !== null) {
    return (
      <CategoryChip
        variant="notCounted"
        label={
          txn.cardBillLabel
            ? t("chipCardBill", { card: txn.cardBillLabel })
            : name ?? (txn.kind === "transfer" ? t("chipTransfer") : t("rowUncategorized"))
        }
        suffix={t("chipNotCounted")}
        notCountedReason={reason}
      />
    );
  }
  let variant: CategoryChipVariant = "normal";
  if (!name) variant = "uncategorized";
  else if (txn.needsReview) variant = "lowConfidence";

  return (
    <span
      className="inline-flex max-w-full"
      title={
        variant === "lowConfidence"
          ? txn.aiConfidence != null
            ? t("chipAiGuess", { score: txn.aiConfidence })
            : t("chipAiGuessUnsure")
          : undefined
      }
    >
      <CategoryChip
        variant={variant}
        label={name ?? t("rowUncategorized")}
        color={txn.categoryColor}
      />
    </span>
  );
}

interface MenuBaseProps {
  txn: TransactionWithCategory;
  t: Translator;
  tCat: CategoryTranslator;
  categories: Category[];
  actions: RowActions;
  disabled: boolean;
}

function CategoryMenuItems({ txn, t, tCat, categories, actions }: Omit<MenuBaseProps, "disabled">) {
  const currentName = txn.categoryName
    ? translateCategoryName(txn.categoryName, tCat)
    : null;
  if (actions.readOnly) {
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("suggestCategoryLabel")}</DropdownMenuLabel>
        {categories.map((cat) => (
          <DropdownMenuItem
            key={cat.id}
            disabled={cat.id === txn.categoryId}
            onClick={() => {
              if (cat.id !== txn.categoryId) actions.changeCategory(txn, cat.id);
            }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
            <span className="min-w-0 flex-1 truncate">{translateCategoryName(cat.name, tCat)}</span>
            {cat.id === txn.categoryId ? <Check className="h-3.5 w-3.5 text-muted-foreground" /> : null}
            {actions.pendingFor(txn)?.to.id === cat.id ? <Clock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    );
  }
  return (
    <>
      {txn.needsReview && currentName ? (
        <>
          <DropdownMenuItem onClick={() => actions.approve(txn)} title={t("rowApproveTooltip")}>
            <Check className="h-3.5 w-3.5" style={{ color: INCOME_INK }} />
            {t("categoryMenuKeep", { category: currentName })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      ) : null}
      {categories.map((cat) => (
        <DropdownMenuItem
          key={cat.id}
          onClick={() => {
            if (cat.id !== txn.categoryId) actions.changeCategory(txn, cat.id);
          }}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: cat.color }}
          />
          <span className="min-w-0 flex-1 truncate">
            {translateCategoryName(cat.name, tCat)}
          </span>
          {cat.id === txn.categoryId ? (
            <Check className="h-3.5 w-3.5 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function CategoryMenu({
  children,
  triggerClassName,
  triggerLabel,
  ...menu
}: MenuBaseProps & {
  children: React.ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
          triggerClassName
        )}
        disabled={menu.disabled}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56">
        <CategoryMenuItems {...menu} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMoreMenu({
  includeCategory,
  ...menu
}: MenuBaseProps & { includeCategory: boolean }) {
  const { txn, t, actions, disabled } = menu;
  const otherKinds: Record<Kind, Array<{ value: Kind; label: string }>> = {
    expense: [
      { value: "income", label: t("markAsIncome") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    income: [
      { value: "expense", label: t("markAsExpense") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    transfer: [
      { value: "expense", label: t("markAsExpense") },
      { value: "income", label: t("markAsIncome") },
    ],
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={ICON_BUTTON_CLASS}
        disabled={disabled}
        aria-label={t("actionMore")}
        title={t("actionMore")}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {actions.readOnly ? (
          <>
            <DropdownMenuItem onClick={() => actions.openHistory(txn)}>
              <History className="h-3.5 w-3.5" />
              {t("historyOpen")}
            </DropdownMenuItem>
            {includeCategory && menu.categories.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Tag className="h-3.5 w-3.5" />
                  {t("suggestCategoryLabel")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 w-56">
                  <CategoryMenuItems {...menu} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </>
        ) : (
          <OwnerMoreItems includeCategory={includeCategory} otherKinds={otherKinds} {...menu} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OwnerMoreItems({
  includeCategory,
  otherKinds,
  ...menu
}: MenuBaseProps & {
  includeCategory: boolean;
  otherKinds: Record<Kind, Array<{ value: Kind; label: string }>>;
}) {
  const { txn, t, actions } = menu;
  return (
    <>
        <DropdownMenuItem onClick={() => actions.editText(txn)}>
          <Pencil className="h-3.5 w-3.5" />
          {isForeignPurchase(txn) ? t("renameActionForeign") : t("renameAction")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.openHistory(txn)}>
          <History className="h-3.5 w-3.5" />
          {t("historyOpen")}
        </DropdownMenuItem>
        {txn.categoryId != null && txn.chargedAmount < 0 && txn.categoryName ? (
          <DropdownMenuItem onClick={() => actions.editBudget(txn)}>
            <PiggyBank className="h-3.5 w-3.5" />
            {t("editCategoryBudget", { category: translateCategoryName(txn.categoryName, menu.tCat) })}
          </DropdownMenuItem>
        ) : null}
        {txn.chargedAmount < 0 && txn.type !== "installments" ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CalendarClock className="h-3.5 w-3.5" />
              {t("trackSubscription")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              {TRACK_CADENCES.map((c) => (
                <DropdownMenuItem key={c} onClick={() => actions.trackSubscription(txn, c)}>
                  {t(`trackCadence.${c}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        {includeCategory && menu.categories.length > 0 ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag className="h-3.5 w-3.5" />
                {t("actionChangeCategory")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-56">
                <CategoryMenuItems {...menu} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {txn.isExcluded ? (
          <DropdownMenuItem onClick={() => void actions.toggleExcluded(txn, false)}>
            <Eye className="h-3.5 w-3.5" />
            {t("includeAction")}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => void actions.toggleExcluded(txn, false)}>
              <EyeOff className="h-3.5 w-3.5" />
              {t("excludeAction")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void actions.toggleExcluded(txn, true)}>
              <EyeOff className="h-3.5 w-3.5" />
              {t("excludeMerchantAction")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {otherKinds[txn.kind].map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => actions.changeKind(txn, opt.value)}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {opt.label}
          </DropdownMenuItem>
        ))}
    </>
  );
}

/**
 * A suggested category waiting for the owner, beside the row's category. The
 * owner can approve or decline it right here; the viewer who sent it can take
 * it back.
 */
function PendingRequestPill({
  txn,
  actions,
  tCat,
  compact = false,
}: {
  txn: TransactionWithCategory;
  actions: RowActions;
  tCat: CategoryTranslator;
  compact?: boolean;
}) {
  const t = useTranslations("sharing.requests");
  const req = actions.pendingFor(txn);
  if (!req) return null;
  const to = translateCategoryName(req.to.name, tCat);
  const title = actions.readOnly ? t("pillWaiting", { category: to }) : t("pillSuggested", { name: req.requestedBy, category: to });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full border border-dashed border-[color-mix(in_oklch,var(--status-heads-up)_55%,var(--border))] px-2 text-[11.5px] font-medium text-[color-mix(in_oklch,var(--status-heads-up)_50%,var(--foreground))] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={title}
        title={title}
      >
        <Clock className="h-3 w-3 shrink-0" />
        <span className={cn("truncate", compact && "max-w-[6.5rem]")}>{to}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="whitespace-normal font-normal leading-snug">
            {title}
            {req.note ? <span className="mt-1 block italic">“{req.note}”</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {actions.readOnly ? (
          <DropdownMenuItem onClick={() => actions.withdrawRequest(req)}>
            <Undo2 className="h-3.5 w-3.5" />
            {t("withdraw")}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => actions.decideRequest(req, "approve")}>
              <Check className="h-3.5 w-3.5" style={{ color: INCOME_INK }} />
              {t("approveAs", { category: to })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.decideRequest(req, "decline")}>
              <X className="h-3.5 w-3.5" />
              {t("decline")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowCheckbox({
  checked,
  indeterminate = false,
  onToggle,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  label: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative flex size-4 items-center justify-center rounded-[4px] border-[1.5px] outline-none transition-colors after:absolute after:-inset-2.5 focus-visible:ring-3 focus-visible:ring-ring/50",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/25 bg-card hover:border-foreground/45"
      )}
    >
      {checked ? (
        <Check className="size-3" strokeWidth={3} />
      ) : indeterminate ? (
        <Minus className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}

function DayLabel({
  dayKey,
  locale,
  t,
}: {
  dayKey: string;
  locale: Locale;
  t: Translator;
}) {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const now = new Date();
  const todayKey = localDayKey(now.toISOString());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday.toISOString());
  const bcp = bcp47(locale);
  const weekday = date.toLocaleDateString(bcp, { weekday: "long" });
  const dayMonth = date.toLocaleDateString(bcp, {
    day: "numeric",
    month: "long",
    ...(y !== now.getFullYear() ? { year: "numeric" } : {}),
  });

  if (dayKey === todayKey || dayKey === yesterdayKey) {
    return (
      <>
        <b className="font-semibold text-foreground">
          {dayKey === todayKey ? t("dayToday") : t("dayYesterday")}
        </b>
        {" · "}
        {weekday}, {dayMonth}
      </>
    );
  }
  return (
    <>
      <b className="font-semibold text-foreground">{weekday}</b>, {dayMonth}
    </>
  );
}

function DayTotalText({ totals, locale }: { totals: DayTotals; locale: Locale }) {
  const parts: React.ReactNode[] = [];
  if (totals.spent > 0) {
    parts.push(
      <span key="spent" className="text-foreground">
        {formatCurrency(totals.spent, "ILS", locale)}
      </span>
    );
  }
  if (totals.income > 0) {
    parts.push(
      <span key="income" style={{ color: INCOME_INK }}>
        <bdi>+{formatCurrency(totals.income, "ILS", locale)}</bdi>
      </span>
    );
  }
  if (parts.length === 0 && totals.notCounted > 0) {
    parts.push(<span key="nc">{formatCurrency(totals.notCounted, "ILS", locale)}</span>);
  }
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? " · " : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

function BulkBar({
  rows,
  busy,
  locale,
  t,
  tCat,
  expenseCategories,
  incomeCategories,
  onSetCategory,
  onSetExcluded,
  onClear,
}: {
  rows: TransactionWithCategory[];
  busy: boolean;
  locale: Locale;
  t: Translator;
  tCat: CategoryTranslator;
  expenseCategories: Category[];
  incomeCategories: Category[];
  onSetCategory: (categoryId: number) => void;
  onSetExcluded: (excluded: boolean) => void;
  onClear: () => void;
}) {
  const net = rows.reduce((sum, r) => sum + r.chargedAmount, 0);
  const allExcluded = rows.every((r) => r.isExcluded);
  const hasIncome = rows.some((r) => r.chargedAmount > 0);
  const hasExpense = rows.some((r) => r.chargedAmount <= 0);
  const barButton =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-background/25 px-2.5 text-[13px] font-medium text-background outline-none transition-colors hover:bg-background/10 focus-visible:ring-3 focus-visible:ring-background/40 disabled:opacity-50";

  const renderGroup = (label: string, cats: Category[]) => (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {cats.map((cat) => (
        <DropdownMenuItem key={cat.id} onClick={() => onSetCategory(cat.id)}>
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
          {translateCategoryName(cat.name, tCat)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  );

  return (
    <div
      role="region"
      aria-label={t("bulkSelected", { count: rows.length })}
      className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-20 md:bottom-3 mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-foreground px-3.5 py-2.5 text-[13px] text-background shadow-lg"
    >
      <b className="tabular-nums">{t("bulkSelected", { count: rows.length })}</b>
      <span className="tabular-nums opacity-70">
        · <bdi>{net > 0 ? "+" : ""}{formatCurrency(net, "ILS", locale)}</bdi>
      </span>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger className={barButton} disabled={busy}>
          <Tag className="h-3.5 w-3.5" />
          {t("bulkSetCategory")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-80 w-56">
          {hasExpense ? renderGroup(t("bulkSpendingCategories"), expenseCategories) : null}
          {hasExpense && hasIncome ? <DropdownMenuSeparator /> : null}
          {hasIncome ? renderGroup(t("bulkIncomeCategories"), incomeCategories) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={barButton}
        disabled={busy}
        onClick={() => onSetExcluded(!allExcluded)}
      >
        {allExcluded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {allExcluded ? t("actionCountAgain") : t("actionDontCount")}
      </button>
      <button
        type="button"
        className={cn(barButton, "w-8 justify-center px-0")}
        onClick={onClear}
        aria-label={t("bulkClear")}
        title={t("bulkClear")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
