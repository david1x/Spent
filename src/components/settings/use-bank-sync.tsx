"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { startSync, type SyncProgressEvent } from "@/lib/api";
import { BANK_PROVIDERS } from "@/lib/types";
import { useSync } from "@/components/dashboard/sync-button";

/** Banks that text a one-time code, which only the app-wide sync dialog can collect. */
function asksForCode(provider: string | undefined): boolean {
  const bank = provider ? BANK_PROVIDERS.find((b) => b.id === provider) : undefined;
  return Boolean(bank?.supportsProgrammaticTwoFactor || bank?.asksCodeInApp);
}

export interface SyncState {
  syncing: boolean;
  stage: string;
}

export function useBankSync() {
  const queryClient = useQueryClient();
  const globalSync = useSync();
  const [state, setState] = useState<Record<number, SyncState>>({});

  const start = useCallback(
    (credentialId: number, provider?: string, cards?: string[]) => {
      // The app-wide sync shows a progress dialog with a field for the code.
      if (asksForCode(provider) && globalSync) {
        globalSync.start(credentialId);
        return;
      }
      setState((prev) => ({
        ...prev,
        [credentialId]: { syncing: true, stage: "Connecting…" },
      }));
      const { cancel } = startSync(credentialId, (event: SyncProgressEvent) => {
        if (event.type === "provider-start") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Pulling transactions…" },
          }));
        } else if (event.type === "provider-2fa-needed") {
          cancel();
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: false, stage: "" },
          }));
          const label =
            (event.data.label as string | undefined) ??
            (event.data.provider as string | undefined) ??
            "Bank";
          toast.warning(`${label} needs a 2FA code`, {
            description:
              "Press Sync at the top of the page to enter the code. Spent remembers the sign-in afterwards, so you only do this once.",
            duration: 12000,
            closeButton: true,
          });
        } else if (event.type === "provider-done" && event.data.ok === false) {
          toast.error(
            (event.data.errorMessage as string | undefined) ??
              `${(event.data.label as string | undefined) ?? "Bank"} didn't sync`,
            { duration: 12_000, closeButton: true }
          );
        } else if (event.type === "provider-2fa-manual") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Solve 2FA in popup…" },
          }));
        } else if (event.type === "stage") {
          const s = event.data.stage as string;
          setState((prev) => ({
            ...prev,
            [credentialId]: {
              syncing: true,
              stage: s === "categorizing" ? "Categorizing…" : "Working…",
            },
          }));
        } else if (event.type === "complete") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: false, stage: "" },
          }));
          const data = event.data as {
            added: number;
            updated: number;
            categorized: number;
          };
          toast.success(
            `Sync complete: ${data.added} new, ${data.updated} updated, ${data.categorized} categorized`
          );
          queryClient.invalidateQueries({ queryKey: ["integrations"] });
          queryClient.invalidateQueries({ queryKey: ["summary"] });
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
        } else if (event.type === "error") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: false, stage: "" },
          }));
          toast.error((event.data.message as string) ?? "Sync failed", {
            duration: Infinity,
            closeButton: true,
          });
        }
      }, cards);
    },
    [queryClient, globalSync]
  );

  const stateFor = (credentialId: number): SyncState =>
    state[credentialId] ?? { syncing: false, stage: "" };

  const anySyncing = Object.values(state).some((s) => s.syncing);

  return { start, stateFor, anySyncing };
}
