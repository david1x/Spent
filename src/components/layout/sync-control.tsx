"use client";

import { useAccess } from "@/components/access-provider";
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getActivity, getHome } from "@/lib/api";
import { SyncStatusSegment } from "@/components/home/sync-status-pill";
import { CategorizeButton } from "@/components/dashboard/categorize-button";
import { useAutoStartSync, useSync } from "@/components/dashboard/sync-button";

interface SyncControlProps {
  /** Start a sync on mount (the `?sync=1` handoff from setup). */
  autoStart?: boolean;
  className?: string;
}

/**
 * Header sync control: a secondary Categorize action plus a split button whose
 * left half shows bank status and whose right half runs Sync & Categorize.
 */
export function SyncControl({ autoStart = false, className }: SyncControlProps) {
  const t = useTranslations("dashboard");
  const { readOnly } = useAccess();
  const queryClient = useQueryClient();
  const sync = useSync();
  useAutoStartSync(autoStart && !readOnly);
  const syncing = sync?.syncing ?? false;

  // Same key and fetcher as the Home page, so on Home this is a cache hit.
  const { data: home } = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
  });

  const [popoverOpen, setPopoverOpen] = useState(false);
  const { data: activity } = useQuery({
    queryKey: ["activity"],
    queryFn: getActivity,
    refetchInterval: (q) => {
      if (popoverOpen) return 3000;
      if (q.state.data?.sync.active) return 3000;
      return 15000;
    },
    refetchIntervalInBackground: false,
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
      if (open) queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    [queryClient]
  );

  const handleCategorized = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
  }, [queryClient]);

  // Syncing is the owner's; their banks, their passwords.
  if (readOnly) return null;
  return (
    <div className={cn("flex items-center gap-1 sm:gap-2", className)}>
      <CategorizeButton
        variant="ghost"
        compactOnMobile
        onApplied={handleCategorized}
      />
      <div className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-border bg-card shadow-xs">
        <SyncStatusSegment
          items={home?.bankHealth ?? null}
          nextScheduledSync={home?.nextScheduledSync ?? null}
          activity={activity ?? null}
          syncing={syncing}
          onOpenChange={handleOpenChange}
          className="border-e border-border"
        />
        <Button
          size="sm"
          onClick={() => sync?.start()}
          disabled={syncing || !sync}
          aria-label={syncing ? t("syncing") : t("syncAndCategorize")}
          title={t("syncAndCategorize")}
          className="h-auto gap-1.5 rounded-none px-2.5 focus-visible:ring-inset focus-visible:ring-primary-foreground/80 focus-visible:ring-offset-0 sm:px-3"
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", syncing && "animate-spin")}
          />
          <span className="hidden sm:inline">
            {syncing ? t("syncing") : t("sync")}
          </span>
        </Button>
      </div>
    </div>
  );
}
