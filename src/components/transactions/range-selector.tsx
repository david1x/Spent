"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type RangePreset = "month" | "3m" | "6m" | "year" | "all" | "custom";

/** Budget periods each preset spans. */
export const PRESET_PERIODS: Record<Exclude<RangePreset, "all" | "custom">, number> = {
  month: 1,
  "3m": 3,
  "6m": 6,
  year: 12,
};

const PRESETS: Array<{ value: Exclude<RangePreset, "custom">; key: string }> = [
  { value: "month", key: "rangeMonth" },
  { value: "3m", key: "range3m" },
  { value: "6m", key: "range6m" },
  { value: "year", key: "rangeYear" },
  { value: "all", key: "rangeAll" },
];

interface RangeSelectorProps {
  preset: RangePreset;
  label: string;
  /** The range on screen, prefilled into the custom fields. */
  from?: string;
  to?: string;
  onPresetChange: (preset: Exclude<RangePreset, "custom">) => void;
  onCustomApply: (from: string, to: string) => void;
  /** Omitted when the range can't step (all time). */
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * Prev / next arrows around a label that opens the range picker: a month,
 * a few months, a year, all time, or any two dates.
 */
export function RangeSelector({
  preset,
  label,
  from,
  to,
  onPresetChange,
  onCustomApply,
  onPrev,
  onNext,
}: RangeSelectorProps) {
  const t = useTranslations("transactions");
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-input bg-background px-1">
      {onPrev ? (
        <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label={t("rangePrev")}>
          <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
        </Button>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "inline-flex h-7 min-w-24 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium whitespace-nowrap tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted sm:min-w-[120px]",
            !onPrev && "ms-1",
            !onNext && "me-1"
          )}
        >
          {preset === "custom" || preset === "all" ? (
            <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          ) : null}
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0">
          {/* Remount on open so the custom fields start from the current range. */}
          {open ? (
            <RangePanel
              preset={preset}
              from={from}
              to={to}
              onPreset={(p) => {
                onPresetChange(p);
                setOpen(false);
              }}
              onApply={(f, tTo) => {
                onCustomApply(f, tTo);
                setOpen(false);
              }}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      {onNext ? (
        <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label={t("rangeNext")}>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        </Button>
      ) : null}
    </div>
  );
}

function RangePanel({
  preset,
  from,
  to,
  onPreset,
  onApply,
}: {
  preset: RangePreset;
  from?: string;
  to?: string;
  onPreset: (preset: Exclude<RangePreset, "custom">) => void;
  onApply: (from: string, to: string) => void;
}) {
  const t = useTranslations("transactions");
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const complete = customFrom !== "" && customTo !== "";
  const invalid = complete && customFrom > customTo;

  return (
    <div>
      <div className="p-3">
        <div className="mb-2 text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
          {t("rangeShow")}
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t("rangeShow")}>
          {PRESETS.map((p) => {
            const active = preset === p.value;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={active}
                onClick={() => onPreset(p.value)}
                className={cn(
                  "h-8 rounded-md border px-2 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                )}
              >
                {t(p.key)}
              </button>
            );
          })}
        </div>
      </div>
      <form
        className="space-y-2.5 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete && !invalid) onApply(customFrom, customTo);
        }}
      >
        <div className="text-[11px] font-bold text-muted-foreground uppercase ltr:tracking-[0.08em]">
          {t("rangeCustom")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="range-from" className="text-xs font-normal text-muted-foreground">
              {t("rangeFrom")}
            </Label>
            <Input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 text-[13px] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="range-to" className="text-xs font-normal text-muted-foreground">
              {t("rangeTo")}
            </Label>
            <Input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 text-[13px] tabular-nums"
            />
          </div>
        </div>
        {invalid ? <p className="text-xs text-destructive">{t("rangeInvalid")}</p> : null}
        <Button type="submit" size="sm" className="w-full" disabled={!complete || invalid}>
          {t("rangeApply")}
        </Button>
      </form>
    </div>
  );
}
