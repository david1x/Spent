"use client";

import { useAccess } from "@/components/access-provider";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translateProviderName } from "@/lib/i18n-data";
import { parseSyncError } from "@/lib/sync-error";
import { listIntegrations } from "@/lib/api";
import { useSync } from "@/components/dashboard/sync-button";
import type { HomeBankHealthItem } from "@/lib/types";

interface Props {
  items: HomeBankHealthItem[] | null;
  className?: string;
}

const TWO_FA_RE = /2fa|otp|verification|change[_ ]?password|invalid[_ ]?password/i;

function isToday(iso: string): boolean {
  const now = new Date();
  const synced = new Date(iso + "Z");
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return fmt(now) === fmt(synced);
}

const DISMISSED_KEY = "spent:dismissed-sync-failures";
const MUTED_KEY = "spent:muted-sync-failures";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: hiding still works until the page reloads.
  }
}

/**
 * Two ways to quiet the banner, kept per browser:
 * - dismiss: hides one failure. It returns if the bank fails again later,
 *   because the failure is remembered by its sync time.
 * - mute: hides a bank's failures until it next syncs successfully, for a
 *   known break (a bank the scraper can't reach yet). The mute lifts by
 *   itself on that success, so a later break warns again.
 */
function useBannerSilencing(items: HomeBankHealthItem[] | null) {
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState<string[]>([]);

  // After mount, so the first render matches the server.
  useEffect(() => {
    setDismissed(readJson(DISMISSED_KEY, {}));
    setMuted(readJson(MUTED_KEY, []));
  }, []);

  useEffect(() => {
    if (!items || muted.length === 0) return;
    const recovered = muted.filter((p) => items.some((i) => i.provider === p && i.status === "ok"));
    if (recovered.length === 0) return;
    const next = muted.filter((p) => !recovered.includes(p));
    setMuted(next);
    writeJson(MUTED_KEY, next);
  }, [items, muted]);

  const isHidden = useCallback(
    (f: HomeBankHealthItem) =>
      muted.includes(f.provider) || (f.lastSyncAt != null && dismissed[f.provider] === f.lastSyncAt),
    [dismissed, muted]
  );

  const dismiss = useCallback((failures: HomeBankHealthItem[]) => {
    setDismissed((prev) => {
      const next = { ...prev };
      for (const f of failures) if (f.lastSyncAt) next[f.provider] = f.lastSyncAt;
      writeJson(DISMISSED_KEY, next);
      return next;
    });
  }, []);

  const mute = useCallback((provider: string) => {
    setMuted((prev) => {
      const next = prev.includes(provider) ? prev : [...prev, provider];
      writeJson(MUTED_KEY, next);
      return next;
    });
  }, []);

  return { isHidden, dismiss, mute };
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function SyncFailureBanner({ items, className }: Props) {
  const t = useTranslations("syncFailureBanner");
  const { readOnly } = useAccess();
  const tBanks = useTranslations("banks");
  const tDashboard = useTranslations("dashboard");
  const sync = useSync();
  const { isHidden, dismiss, mute } = useBannerSilencing(items);
  const failures = (items ?? []).filter(
    (i) => i.status === "error" && i.lastSyncAt && isToday(i.lastSyncAt) && !isHidden(i)
  );
  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: listIntegrations,
    enabled: failures.length === 1,
  });
  if (readOnly || !items || failures.length === 0) return null;

  // Bank health is keyed by provider, so retry just that connection only when
  // it maps to exactly one; otherwise fall back to a full sync.
  const retryCredentialId = (() => {
    if (failures.length !== 1 || !integrations) return undefined;
    const matches = integrations.filter((i) => i.provider === failures[0].provider);
    return matches.length === 1 ? matches[0].id : undefined;
  })();

  const firstName = translateProviderName(
    failures[0].provider,
    failures[0].providerName,
    tBanks,
  );

  const headline =
    failures.length === 1
      ? t("oneBankTitle", { bank: firstName })
      : t("multiBankTitle", { count: failures.length });

  const showsTwoFAHint = failures.some(
    (f) => f.errorMessage && TWO_FA_RE.test(f.errorMessage)
  );
  const someBanksOk = items.some((i) => i.status === "ok");

  // A bank that needs attention is a to-do, not an emergency: amber, not red.
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5",
        className
      )}
      style={{
        background:
          "color-mix(in oklch, var(--status-heads-up) 14%, var(--card))",
        borderColor:
          "color-mix(in oklch, var(--status-heads-up) 40%, var(--border))",
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card"
        style={{
          color:
            "color-mix(in oklch, var(--status-heads-up) 60%, var(--foreground))",
        }}
      >
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-serif text-base leading-tight tracking-tight">
          {headline}
        </div>
        <ul className="mt-1 space-y-2 text-sm text-muted-foreground">
          {failures.map((f) => {
            const name = translateProviderName(f.provider, f.providerName, tBanks);
            const parsed = parseSyncError(f.errorMessage);
            return (
              <li key={f.provider} className="max-w-[70ch]">
                {failures.length > 1 ? (
                  <span className="font-medium text-foreground/80">{name}: </span>
                ) : null}
                {parsed?.summary ?? t("fallbackErrorMsg")}
                {failures.length === 1 && someBanksOk ? ` ${t("othersOk")}` : ""}
                {parsed?.detail ? (
                  <details className="mt-1.5 text-xs">
                    <summary className="w-fit cursor-pointer select-none text-muted-foreground hover:text-foreground">
                      {t("technicalDetails")}
                    </summary>
                    <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-card px-2.5 py-2 font-mono text-[11px] leading-relaxed">
                      {truncate(parsed.detail, 1200)}
                    </pre>
                  </details>
                ) : null}
                <button
                  type="button"
                  className="mt-1.5 block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => mute(f.provider)}
                >
                  {t("muteBank", { bank: name })}
                </button>
              </li>
            );
          })}
        </ul>
        {showsTwoFAHint && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("twoFaHelper")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 self-start sm:justify-end">
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          className="bg-card"
          render={<Link href="/settings/bank">{t("reconnectBank")}</Link>}
        />
        {sync && (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={sync.syncing}
            onClick={() => sync.start(retryCredentialId)}
          >
            <RefreshCw
              aria-hidden
              className={cn("size-3.5", sync.syncing && "animate-spin")}
            />
            {sync.syncing ? tDashboard("syncing") : t("tryAgain")}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={t("dismiss")}
          title={t("dismiss")}
          onClick={() => dismiss(failures)}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
