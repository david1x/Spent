"use client";

import { ArrowLeftRight, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoryChipVariant =
  | "normal"
  | "uncategorized"
  | "lowConfidence"
  | "notCounted";

interface CategoryChipProps {
  variant: CategoryChipVariant;
  label: string;
  color?: string | null;
  /** For not-counted rows: which icon explains why. */
  notCountedReason?: "transfer" | "excluded" | "category";
  /** Suffix for not-counted chips, e.g. "Not counted". */
  suffix?: string;
  className?: string;
}

// Text mixed toward the foreground keeps 4.5:1 contrast on the tinted
// background in both themes; the raw hue stays in the dot.
const AMBER_INK = "color-mix(in oklch, var(--status-heads-up) 55%, var(--foreground))";

export function CategoryChip({
  variant,
  label,
  color,
  notCountedReason,
  suffix,
  className,
}: CategoryChipProps) {
  const base =
    "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full ps-[7px] pe-[9px] text-xs font-medium whitespace-nowrap";

  if (variant === "notCounted") {
    const Icon = notCountedReason === "excluded" ? EyeOff : ArrowLeftRight;
    return (
      <span className={cn(base, "bg-muted text-muted-foreground", className)}>
        {notCountedReason === "category" ? (
          <span
            className="size-[7px] shrink-0 rounded-full bg-muted-foreground/50"
            aria-hidden
          />
        ) : (
          <Icon className="h-3 w-3 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {label}
          {suffix ? <span className="opacity-80"> · {suffix}</span> : null}
        </span>
      </span>
    );
  }

  if (variant === "lowConfidence") {
    return (
      <span
        className={cn(base, "border border-dashed bg-card", className)}
        style={{ borderColor: "var(--status-heads-up)", color: AMBER_INK }}
      >
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ backgroundColor: "var(--status-heads-up)" }}
          aria-hidden
        />
        <span className="min-w-0 truncate">{label}?</span>
      </span>
    );
  }

  if (variant === "uncategorized" || !color) {
    return (
      <span
        className={cn(
          base,
          "border border-dashed border-foreground/20 text-muted-foreground",
          className
        )}
      >
        <span
          className="size-[7px] shrink-0 rounded-full bg-muted-foreground/40"
          aria-hidden
        />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(base, className)}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 18%, var(--card))`,
        color: `color-mix(in oklch, ${color} 45%, var(--foreground))`,
      }}
    >
      <span
        className="size-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
