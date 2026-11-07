"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLastSync, formatJerusalemTimeOfDay } from "@/lib/formatters";
import { translateProviderName, useFormatterLabels } from "@/lib/i18n-data";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ActivitySnapshot, HomeBankHealthItem } from "@/lib/types";

type PillTone = "ok" | "warn" | "error" | "muted" | "active";

interface SegmentState {
  tone: PillTone;
  /** Full label, e.g. "3 of 4 banks · 7m ago". */
  label: string;
  /** Phone label, e.g. "3/4". */
  compact: string;
}

const TONE_STYLES: Record<PillTone, { dot: string; text: string; pulse: boolean }> = {
  ok: {
    dot: "bg-[var(--status-on-track)]",
    text: "text-foreground",
    pulse: false,
  },
  warn: {
    dot: "bg-[var(--status-heads-up)]",
    text: "text-foreground",
    pulse: false,
  },
  error: {
    dot: "bg-[var(--status-over)]",
    text: "text-[var(--status-over)]",
    pulse: false,
  },
  muted: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    pulse: false,
  },
  active: {
    dot: "bg-[var(--primary)]",
    text: "text-foreground",
    pulse: true,
  },
};

function formatElapsed(sinceIso: string | null, justNow: string): string {
  if (!sinceIso) return "";
  const start = new Date(sinceIso).getTime();
  const ageMs = Date.now() - start;
  if (!Number.isFinite(ageMs) || ageMs < 0) return justNow;
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

function syncTime(iso: string): number {
  return new Date(iso + "Z").getTime();
}

function mostRecentSync(items: HomeBankHealthItem[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    if (!i.lastSyncAt) continue;
    if (!best || syncTime(i.lastSyncAt) > syncTime(best)) best = i.lastSyncAt;
  }
  return best;
}

interface SegmentProps {
  items: HomeBankHealthItem[] | null;
  nextScheduledSync: string | null;
  activity: ActivitySnapshot | null;
  /** True while this tab is running a sync (the activity poll can lag). */
  syncing?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * The status half of the header sync control: how many banks are current and
 * when they last synced. Opens a popover with per-bank status and background
 * activity.
 */
export function SyncStatusSegment({
  items,
  nextScheduledSync,
  activity,
  syncing = false,
  onOpenChange,
  className,
}: SegmentProps) {
  const t = useTranslations("syncPill");
  const fmtLabels = useFormatterLabels();
  const syncActive = syncing || activity?.sync.active === true;
  const syncStale = activity?.sync.active === true && activity.sync.stale;
  useTick(syncActive);

  const baseState = useMemo<SegmentState>(() => {
    if (!items || items.length === 0) {
      return { tone: "muted", label: t("noBanksConnected"), compact: "0" };
    }
    const total = items.length;
    const okItems = items.filter((i) => i.status === "ok");
    const healthy = okItems.length;
    const compact = `${healthy}/${total}`;
    const lastSync = mostRecentSync(healthy > 0 ? okItems : items);

    if (!lastSync) {
      return { tone: "muted", label: t("neverSynced"), compact };
    }

    const time = formatLastSync(lastSync, fmtLabels);
    if (healthy === total) {
      return { tone: "ok", label: t("allBanks", { count: total, time }), compact };
    }
    return {
      tone: "warn",
      label: t("someBanks", { healthy, total, time }),
      compact,
    };
  }, [items, t, fmtLabels]);

  let state: SegmentState = baseState;
  if (syncStale) {
    state = { ...baseState, tone: "warn", label: t("syncMayBeStuck") };
  } else if (syncActive) {
    const elapsed = formatElapsed(activity?.sync.since ?? null, fmtLabels.justNow);
    state = {
      ...baseState,
      tone: "active",
      label:
        elapsed && activity?.sync.active
          ? t("syncingNowElapsed", { elapsed })
          : t("syncingNow"),
    };
  }

  const styles = TONE_STYLES[state.tone];

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("statusAria", { status: state.label })}
            className={cn(
              "inline-flex items-center gap-2 px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-accent/60 sm:px-3",
              className
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                styles.dot,
                styles.pulse && "animate-pulse"
              )}
            />
            <span className="tabular-nums sm:hidden">{state.compact}</span>
            <span className="hidden whitespace-nowrap tabular-nums sm:inline">
              {state.label}
            </span>
          </button>
        }
      />
      <PopoverContent className="w-80 p-0">
        <BankStatusList items={items} />
        <div className="border-t border-border p-3">
          <ActivityPanel activity={activity} nextScheduledSync={nextScheduledSync} />
        </div>
        <Link
          href="/settings/bank"
          className="flex items-center justify-between gap-2 rounded-b-lg border-t border-border px-3 py-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {t("manageBanks")}
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

const BANK_STATUS_TONE: Record<HomeBankHealthItem["status"], PillTone> = {
  ok: "ok",
  stale: "warn",
  error: "warn",
  never: "muted",
};

function BankStatusList({ items }: { items: HomeBankHealthItem[] | null }) {
  const t = useTranslations("syncPill");
  const tBanks = useTranslations("banks");
  const fmtLabels = useFormatterLabels();

  if (!items || items.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {t("noBanksConnected")}
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-2 text-xs font-medium text-foreground">
        {t("banksTitle")}
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const tone = TONE_STYLES[BANK_STATUS_TONE[item.status]];
          let detail: string;
          if (item.status === "error") detail = t("bankNeedsAttention");
          else if (item.status === "never") detail = fmtLabels.never;
          else detail = formatLastSync(item.lastSyncAt, fmtLabels);
          return (
            <li
              key={item.provider}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", tone.dot)}
                />
                <span className="truncate text-foreground">
                  {translateProviderName(item.provider, item.providerName, tBanks)}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-end",
                  item.status === "error" || item.status === "stale"
                    ? "font-medium text-[color-mix(in_oklch,var(--status-heads-up)_60%,var(--foreground))]"
                    : "text-muted-foreground"
                )}
              >
                {detail}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActivityPanel({
  activity,
  nextScheduledSync,
}: {
  activity: ActivitySnapshot | null;
  nextScheduledSync: string | null;
}) {
  const t = useTranslations("activityPanel");
  const fmtLabels = useFormatterLabels();
  const sync = activity?.sync;
  const scheduler = activity?.scheduler;
  const ollama = activity?.ollama;

  let syncRow: { tone: PillTone; text: string };
  if (!sync) {
    syncRow = { tone: "muted", text: fmtLabels.never };
  } else if (!sync.active) {
    syncRow = { tone: "muted", text: t("syncIdle") };
  } else if (sync.stale) {
    syncRow = { tone: "warn", text: t("syncMayBeStuck") };
  } else {
    const elapsed = formatElapsed(sync.since, fmtLabels.justNow);
    const kindLabel = sync.kind === "scheduled" ? t("syncKindScheduled") : t("syncKindManual");
    syncRow = {
      tone: "active",
      text: elapsed
        ? t("syncingKindElapsed", { kind: kindLabel, elapsed })
        : t("syncingKind", { kind: kindLabel }),
    };
  }

  const nextRunAt = scheduler?.nextRunAt ?? nextScheduledSync;
  const schedulerRow: { tone: PillTone; text: string } =
    scheduler?.armed && nextRunAt
      ? { tone: "ok", text: t("schedulerNext", { time: formatJerusalemTimeOfDay(nextRunAt) }) }
      : { tone: "muted", text: t("schedulerOff") };

  const ollamaRow: { tone: PillTone; text: string } = ollama?.running
    ? { tone: "ok", text: t("ollamaRunning") }
    : { tone: "muted", text: t("ollamaNotRunning") };

  return (
    <div className="space-y-2.5">
      <div className="text-xs font-medium text-foreground">{t("title")}</div>
      <Row label={t("syncLabel")} value={syncRow.text} tone={syncRow.tone} />
      <Row label={t("schedulerLabel")} value={schedulerRow.text} tone={schedulerRow.tone} />
      <Row label={t("ollamaLabel")} value={ollamaRow.text} tone={ollamaRow.tone} />
      <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
        {t("footerNote")}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: PillTone;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            styles.dot,
            styles.pulse && "animate-pulse"
          )}
        />
        {label}
      </div>
      <div className={cn("text-end", styles.text)}>{value}</div>
    </div>
  );
}
