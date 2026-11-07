"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseSyncError } from "@/lib/sync-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { startSync, submitSyncOtp } from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import {
  SyncProgressDialog,
  type ProviderRow,
} from "./sync-progress-dialog";

interface SyncContextValue {
  syncing: boolean;
  /** Runs a full sync, or only one bank connection when `credentialId` is given. */
  start: (credentialId?: number) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Owns the one in-app sync run: the SSE stream, the progress dialog, OTP
 * prompts and toasts. Lives in the app shell so the header control and the
 * failure banner's "Try again" drive the same dialog.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [stage, setStage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<{
    added: number;
    updated: number;
    categorized: number;
  } | null>(null);
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const awaitingOtpRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!done || !dialogOpen) return;
    if (aiWarning) return;
    const timer = setTimeout(() => setDialogOpen(false), 3500);
    return () => clearTimeout(timer);
  }, [done, dialogOpen, aiWarning]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const handleSubmitOtp = useCallback(
    async (syncRunId: number, code: string) => {
      await submitSyncOtp(syncRunId, code);
    },
    []
  );

  const finish = useCallback(() => {
    syncingRef.current = false;
    setSyncing(false);
  }, []);

  const start = useCallback(
    (credentialId?: number) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      setProviders([]);
      setRows([]);
      setStage(null);
      setDone(false);
      setSummary(null);
      setAiWarning(null);
      setDialogOpen(true);
      awaitingOtpRef.current = new Set();

      startSync(credentialId, (event) => {
        if (event.type === "plan") {
          const list = (event.data.providers as string[]) ?? [];
          setProviders(list);
          setRows(
            list.map((p) => ({ provider: p, status: "idle", added: 0, updated: 0 }))
          );
        } else if (event.type === "provider-start") {
          const provider = event.data.provider as string;
          setRows((prev) =>
            prev.map((r) =>
              r.provider === provider ? { ...r, status: "running" } : r
            )
          );
        } else if (event.type === "provider-2fa-needed") {
          const provider = event.data.provider as string;
          const syncRunId = event.data.syncRunId as number;
          awaitingOtpRef.current.add(provider);
          setRows((prev) =>
            prev.map((r) =>
              r.provider === provider
                ? { ...r, status: "awaiting-otp", syncRunId }
                : r
            )
          );
        } else if (event.type === "provider-2fa-submitted") {
          const provider = event.data.provider as string;
          awaitingOtpRef.current.delete(provider);
          setRows((prev) =>
            prev.map((r) =>
              r.provider === provider ? { ...r, status: "running" } : r
            )
          );
        } else if (event.type === "provider-2fa-manual") {
          const provider = event.data.provider as string;
          setRows((prev) =>
            prev.map((r) =>
              r.provider === provider ? { ...r, status: "manual-2fa" } : r
            )
          );
        } else if (event.type === "provider-done") {
          const provider = event.data.provider as string;
          const ok = event.data.ok as boolean;
          const added = (event.data.added as number) ?? 0;
          const updated = (event.data.updated as number) ?? 0;
          const errorMessage = parseSyncError(
            event.data.errorMessage as string | undefined
          )?.summary;
          awaitingOtpRef.current.delete(provider);
          setRows((prev) =>
            prev.map((r) =>
              r.provider === provider
                ? {
                    ...r,
                    status: ok ? "done" : "error",
                    added,
                    updated,
                    errorMessage,
                  }
                : r
            )
          );
          if (!ok && errorMessage) {
            toast.error(`${provider}: ${errorMessage}`, {
              duration: 8000,
              closeButton: true,
            });
          }
        } else if (event.type === "stage") {
          setStage((event.data.stage as string) ?? null);
        } else if (event.type === "complete") {
          const added = (event.data.added as number) ?? 0;
          const updated = (event.data.updated as number) ?? 0;
          const categorized = (event.data.categorized as number) ?? 0;
          const warning = event.data.aiWarning as string | null;
          setSummary({ added, updated, categorized });
          setStage(null);
          setDone(true);
          finish();
          setAiWarning(warning ?? null);
          if (warning) {
            toast.warning(t("aiCategorizationIssue"), {
              description: warning,
              duration: 6000,
              closeButton: true,
            });
          }
          // A sync touches nearly every view (balances, budgets, bank health,
          // review queue), so refresh whatever is mounted.
          queryClient.invalidateQueries();
        } else if (event.type === "error") {
          const message = event.data.message as string;
          finish();
          setDialogOpen(false);
          toast.error(message, {
            duration: Infinity,
            closeButton: true,
            description: t("checkDevTerminal"),
          });
          queryClient.invalidateQueries({ queryKey: ["home"] });
          queryClient.invalidateQueries({ queryKey: ["activity"] });
        }
      });
    },
    [finish, queryClient, t]
  );

  const value = useMemo<SyncContextValue>(
    () => ({ syncing, start }),
    [syncing, start]
  );

  return (
    <SyncContext.Provider value={value}>
      {children}
      <SyncProgressDialog
        open={dialogOpen}
        providers={providers}
        rows={rows}
        stage={stage}
        done={done}
        summary={summary}
        aiWarning={aiWarning}
        onClose={closeDialog}
        onSubmitOtp={handleSubmitOtp}
      />
    </SyncContext.Provider>
  );
}

/** Null outside the app shell (for example in the setup wizard). */
export function useSync(): SyncContextValue | null {
  return useContext(SyncContext);
}

/** Starts a sync once on mount when `enabled` (the `?sync=1` handoff from setup). */
export function useAutoStartSync(enabled: boolean) {
  const sync = useSync();
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled || startedRef.current || !sync) return;
    startedRef.current = true;
    sync.start();
  }, [enabled, sync]);
}

interface SyncButtonProps {
  autoStart?: boolean;
  className?: string;
}

/** Standalone primary sync button. The header uses `SyncControl` instead. */
export function SyncButton({ autoStart = false, className }: SyncButtonProps) {
  const t = useTranslations("dashboard");
  const sync = useSync();
  useAutoStartSync(autoStart);
  const syncing = sync?.syncing ?? false;

  return (
    <Button
      size="sm"
      onClick={() => sync?.start()}
      disabled={syncing || !sync}
      className={className ?? "gap-1.5"}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? t("syncing") : t("syncAndCategorize")}
    </Button>
  );
}
