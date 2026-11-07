"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TransactionsSummary } from "@/lib/api";
import type { HomePayload } from "@/lib/types";

/**
 * The review queue size, read passively from data the current pages already
 * fetched (Home's needsAttention.flagged or the Transactions summary). Never
 * triggers a request of its own, so it is null until one of those has loaded.
 */
export function useReviewCount(): number | null {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(onChange),
    [cache]
  );

  const getSnapshot = useCallback((): number | null => {
    let best: { at: number; count: number } | null = null;
    for (const query of cache.getAll()) {
      const key = query.queryKey[0];
      const { data, dataUpdatedAt } = query.state;
      if (data == null) continue;
      let count: number | null = null;
      if (key === "home") {
        count = (data as HomePayload).needsAttention?.flagged ?? null;
      } else if (key === "transactions-summary") {
        count = (data as TransactionsSummary).pendingReviewCount ?? null;
      }
      if (count == null) continue;
      if (!best || dataUpdatedAt > best.at) best = { at: dataUpdatedAt, count };
    }
    return best ? best.count : null;
  }, [cache]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
