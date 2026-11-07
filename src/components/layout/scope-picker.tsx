"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, Wallet } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderBadge } from "@/components/setup/provider-badge";
import { listIntegrations } from "@/lib/api";
import { BANK_PROVIDERS } from "@/lib/types";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-store";
import { getScope, loadScope, setScope, subscribeScope } from "@/lib/scope-store";
import { cn } from "@/lib/utils";

const EMPTY: number[] = [];

/**
 * Header picker for the budget scope: all accounts, or one or more bank
 * bundles (a bank plus the cards linked to it as "Paid from"). Every total in
 * the app follows it; see src/server/lib/scope.ts.
 */
export function ScopePicker() {
  const t = useTranslations("nav");
  const queryClient = useQueryClient();
  const scope = useSyncExternalStore(subscribeScope, getScope, () => EMPTY);
  const { data: integrations } = useQuery({ queryKey: ["integrations"], queryFn: listIntegrations });

  // Apply the saved choice after hydration, then refetch with it.
  useEffect(() => {
    if (loadScope(getActiveWorkspaceIdSync())) void queryClient.invalidateQueries();
  }, [queryClient]);

  const banks = (integrations ?? [])
    .map((i) => ({ integration: i, info: BANK_PROVIDERS.find((p) => p.id === i.provider) }))
    .filter((b) => b.info?.kind === "bank");
  // A scope only makes sense once there's at least one bank to bundle cards under.
  if (banks.length === 0) return null;

  const nameOf = (b: (typeof banks)[number]) =>
    b.integration.label && b.integration.label !== b.info?.name
      ? b.integration.label
      : (b.info?.name ?? b.integration.provider);
  const selected = banks.filter((b) => scope.includes(b.integration.id));
  const label =
    selected.length === 0
      ? t("scopeAll")
      : selected.length === 1
        ? nameOf(selected[0])
        : t("scopeCount", { count: selected.length });

  const apply = (next: number[]) => {
    setScope(next);
    void queryClient.invalidateQueries();
  };

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
          selected.length > 0
            ? "border-border bg-card text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
        aria-label={t("scopeLabel", { scope: label })}
      >
        <Wallet className="size-4 shrink-0" aria-hidden />
        <span className="truncate max-sm:sr-only">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        <div className="px-2 pt-1.5 pb-2 text-xs text-muted-foreground">{t("scopeHint")}</div>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted"
          onClick={() => apply([])}
        >
          <span>{t("scopeAll")}</span>
          {selected.length === 0 ? <Check className="size-4 text-primary" aria-hidden /> : null}
        </button>
        <div className="my-1 h-px bg-border" />
        {banks.map((b) => {
          const id = b.integration.id;
          const on = scope.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-start text-sm hover:bg-muted"
              onClick={() => apply(on ? scope.filter((x) => x !== id) : [...scope, id])}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/25"
                )}
                aria-hidden
              >
                {on ? <Check className="size-3" /> : null}
              </span>
              {b.info ? (
                <ProviderBadge color={b.info.color} name={nameOf(b)} domain={b.info.domain} size={18} radius={5} />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{nameOf(b)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t("scopeLinkedCards", { count: b.integration.linkedCardCount })}
                </span>
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
