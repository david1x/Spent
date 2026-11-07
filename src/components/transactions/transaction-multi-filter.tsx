"use client";

import type { LucideIcon } from "lucide-react";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TransactionMultiFilterProps {
  label: string;
  icon: LucideIcon;
  /** What is selected, or null when the filter is unset. */
  selectedLabel: React.ReactNode | null;
  /** Plain-text version of the selection for the tooltip. */
  selectedTitle?: string;
  /** Shown before the selected label, e.g. a bank mark. Defaults to the icon. */
  leading?: React.ReactNode;
  selectAllLabel: string;
  clearLabel: string;
  /** Accessible label for the inline clear button. */
  removeLabel: string;
  onSelectAll: () => void;
  onClear: () => void;
  showBulkActions?: boolean;
  children: React.ReactNode;
}

/**
 * Filter chip: dashed with a "+" while unset, solid with a clear button once
 * something is picked. Opens a multi-select popover.
 */
export function TransactionMultiFilter({
  label,
  icon: Icon,
  selectedLabel,
  selectedTitle,
  leading,
  selectAllLabel,
  clearLabel,
  removeLabel,
  onSelectAll,
  onClear,
  showBulkActions = true,
  children,
}: TransactionMultiFilterProps) {
  const isSet = selectedLabel != null;

  return (
    <div
      className={cn(
        "inline-flex h-9 max-w-full items-center rounded-lg border text-[13px] transition-colors",
        isSet
          ? "border-border bg-card text-foreground"
          : "border-dashed border-foreground/20 text-muted-foreground hover:border-foreground/35 hover:text-foreground"
      )}
    >
      <Popover>
        <PopoverTrigger
          className={cn(
            "inline-flex h-full min-w-0 items-center gap-1.5 rounded-lg px-3 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
            isSet && "pe-1.5"
          )}
          title={isSet ? `${label}: ${selectedTitle ?? ""}` : label}
        >
          {isSet ? (
            <>
              {leading ?? (
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="sr-only">{label}: </span>
              <span className="min-w-0 truncate font-medium">{selectedLabel}</span>
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          {showBulkActions ? (
            <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onSelectAll}
              >
                {selectAllLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onClear}
              >
                {clearLabel}
              </Button>
            </div>
          ) : null}
          <div className="max-h-72 overflow-y-auto p-1">{children}</div>
        </PopoverContent>
      </Popover>
      {isSet ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={removeLabel}
          title={removeLabel}
          className="me-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

interface MultiFilterOptionProps {
  selected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}

export function MultiFilterOption({
  selected,
  onToggle,
  children,
  className,
}: MultiFilterOptionProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-accent",
        className
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input",
          selected && "border-primary bg-primary text-primary-foreground"
        )}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
