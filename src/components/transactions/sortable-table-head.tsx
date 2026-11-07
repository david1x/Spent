"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortOrder, TransactionSortField } from "@/lib/transaction-sort";

interface SortButtonProps {
  label: string;
  field: TransactionSortField;
  activeField: TransactionSortField;
  activeOrder: SortOrder;
  onSort: (field: TransactionSortField) => void;
  sortAscLabel: string;
  sortDescLabel: string;
  className?: string;
}

export function SortButton({
  label,
  field,
  activeField,
  activeOrder,
  onSort,
  sortAscLabel,
  sortDescLabel,
  className,
}: SortButtonProps) {
  const active = activeField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "text-foreground",
        className
      )}
      title={active ? (activeOrder === "asc" ? sortAscLabel : sortDescLabel) : label}
    >
      <span>{label}</span>
      {active ? (
        activeOrder === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
      )}
    </button>
  );
}

interface SortableTableHeadProps extends SortButtonProps {
  align?: "start" | "end";
  /** Extra content after the sort button, e.g. a second sort button. */
  children?: React.ReactNode;
}

export const TABLE_HEAD_CLASS =
  "px-3.5 py-2.5 text-start align-middle text-[11px] font-semibold tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase";

export function SortableTableHead({
  align = "start",
  className,
  children,
  ...button
}: SortableTableHeadProps) {
  const active = button.activeField === button.field;
  const ariaSort = active
    ? button.activeOrder === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(TABLE_HEAD_CLASS, align === "end" && "text-end", className)}
    >
      <SortButton {...button} />
      {children}
    </th>
  );
}
