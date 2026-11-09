"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { checkLoginCards, listLoginCards, listWorkspaces, updateLoginCard } from "@/lib/api";
import { useBankSync } from "@/components/settings/use-bank-sync";
import { cn } from "@/lib/utils";
import type { Integration, LoginCard } from "@/lib/types";

/**
 * Settings, Banks, a card login: every card the card company lists, found
 * with a quick check (sign in, read the list, no transactions). Each card can
 * be left out of syncs, synced on its own, and, before its first
 * transactions arrive, pointed at a workspace.
 */
export function LoginCardsSection({
  login,
  compact = false,
}: {
  login: Pick<Integration, "id" | "provider">;
  /** Inside another section: no heading of its own. */
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["integrations", login.id, "card-list"];
  const { data: cards = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listLoginCards(login.id),
  });
  const { data: workspaces = [] } = useQuery({ queryKey: ["workspaces"], queryFn: listWorkspaces });
  const { start, stateFor } = useBankSync();
  const syncState = stateFor(login.id);
  const [syncingCard, setSyncingCard] = useState<string | null>(null);

  const setCards = (next: LoginCard[]) => queryClient.setQueryData(queryKey, next);

  const check = useMutation({
    mutationFn: () => checkLoginCards(login.id),
    onSuccess: (next) => {
      const fresh = next.filter((c) => c.listed && c.transactionCount === 0).length;
      setCards(next);
      toast.success(
        fresh > 0
          ? `Found ${next.length} cards, ${fresh} new. Choose which ones to sync.`
          : `Found ${next.length} cards. Nothing new.`
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't read the card list."),
  });

  const update = useMutation({
    mutationFn: (change: { accountNumber: string; syncEnabled?: boolean; workspaceId?: number }) =>
      updateLoginCard(login.id, change),
    onSuccess: setCards,
    onError: () => toast.error("Couldn't save that change."),
  });

  const syncCard = (card: LoginCard) => {
    setSyncingCard(card.accountNumber);
    start(login.id, login.provider, [card.accountNumber]);
  };
  const busy = check.isPending || syncState.syncing;
  const excluded = cards.filter((c) => !c.syncEnabled).length;

  return (
    <section>
      <div className={cn("flex items-start justify-between gap-3", compact && "items-center")}>
        <div className="min-w-0">
          {compact ? null : (
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Your cards
            </div>
          )}
          <p className={cn("text-[11px] leading-relaxed text-muted-foreground", !compact && "mt-1.5")}>
            Every card on this login. Switch off the ones Spent shouldn&apos;t sync, or sync one card on its
            own.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          disabled={busy}
          onClick={() => check.mutate()}
        >
          {check.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ScanSearch className="h-3.5 w-3.5" aria-hidden />
          )}
          {check.isPending ? "Checking…" : "Check for cards"}
        </Button>
      </div>

      <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading cards…</div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="max-w-xs text-xs text-muted-foreground">
              {check.isPending
                ? "Signing in and reading the card list. This takes about half a minute."
                : "Check for cards to see every card on this login before the first full sync."}
            </p>
          </div>
        ) : (
          cards.map((card) => (
            <CardLine
              key={card.accountNumber}
              card={card}
              workspaces={workspaces}
              saving={update.isPending && update.variables?.accountNumber === card.accountNumber}
              syncing={syncState.syncing && (syncingCard === null || syncingCard === card.accountNumber)}
              syncStage={syncState.stage}
              disabled={busy}
              onToggle={(syncEnabled) => update.mutate({ accountNumber: card.accountNumber, syncEnabled })}
              onWorkspace={(workspaceId) => update.mutate({ accountNumber: card.accountNumber, workspaceId })}
              onSync={() => syncCard(card)}
            />
          ))
        )}
      </div>
      {check.isPending && cards.length > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Signing in and reading the card list. This takes about half a minute.
        </p>
      ) : excluded > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {excluded === 1 ? "1 card is" : `${excluded} cards are`} left out of every sync, scheduled ones
          included.
        </p>
      ) : null}
    </section>
  );
}

function CardLine({
  card,
  workspaces,
  saving,
  syncing,
  syncStage,
  disabled,
  onToggle,
  onWorkspace,
  onSync,
}: {
  card: LoginCard;
  workspaces: { id: number; name: string }[];
  saving: boolean;
  syncing: boolean;
  syncStage: string;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onWorkspace: (workspaceId: number) => void;
  onSync: () => void;
}) {
  const last4 = card.accountNumber.slice(-4);
  const fresh = card.transactionCount === 0;
  const switchId = `card-sync-${card.accountNumber}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 p-4", !card.syncEnabled && "bg-muted/25")}>
      <div className="flex min-w-[11rem] flex-1 items-center gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg bg-muted",
            !card.syncEnabled && "opacity-50"
          )}
          aria-hidden
        >
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className={cn(!card.syncEnabled && "text-muted-foreground")}>
              {/* Isolated so a Hebrew name and the digits each keep their own direction. */}
              <bdi>{card.label ?? "Card"}</bdi>{" "}
              <bdi dir="ltr" className="font-mono text-[13px]">
                ••{last4}
              </bdi>
            </span>
            {!card.active ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Cancelled
              </span>
            ) : null}
            {fresh && card.listed ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                New
              </span>
            ) : null}
          </div>
          {syncing ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {syncStage || "Syncing…"}
            </div>
          ) : fresh ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              No transactions yet. Goes to
              <Select
                value={String(card.workspaceId)}
                onValueChange={(v) => v && onWorkspace(Number(v))}
                disabled={saving || disabled}
              >
                <SelectTrigger size="sm" className="h-6 gap-1 px-2 text-[11px]" aria-label={`Workspace for card ${last4}`}>
                  <SelectValue>
                    {(v: string) => workspaces.find((w) => String(w.id) === v)?.name ?? card.workspaceName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {card.transactionCount} {card.transactionCount === 1 ? "transaction" : "transactions"} · in{" "}
              <span className="font-medium text-foreground">{card.workspaceName}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <label htmlFor={switchId} className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          Sync
          <Switch
            id={switchId}
            checked={card.syncEnabled}
            disabled={saving}
            onCheckedChange={(checked) => onToggle(checked)}
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={disabled}
          onClick={onSync}
          title={`Sync only card ${last4}`}
          aria-label={`Sync only card ${last4}`}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Sync now</span>
        </Button>
      </div>
    </div>
  );
}
