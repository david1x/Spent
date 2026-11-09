"use client";

import { useAccess } from "@/components/access-provider";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { parseSyncError } from "@/lib/sync-error";
import { formatLastSync } from "@/lib/formatters";
import { translateProviderName, useFormatterLabels } from "@/lib/i18n-data";
import { BANK_PROVIDERS, type HomeBankHealthItem } from "@/lib/types";
import { ProviderBadge } from "@/components/setup/provider-badge";
import { CardShell, CardAction } from "./card-shell";
import { AMBER_INK } from "./home-format";

interface Props {
  items: HomeBankHealthItem[];
}

export function BankHealthCard({ items }: Props) {
  const t = useTranslations("home");
  const { readOnly } = useAccess();
  // Connecting and fixing banks happens in Settings, which a viewer doesn't have.
  if (readOnly) return null;
  return (
    <div id="bank-health" className="contents">
      <CardShell
        label={t("banks")}
        action={<CardAction href="/settings/bank">{t("manage")}</CardAction>}
      >
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
            {t("noBanksConnectedYet")}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.provider}>
                <Row item={item} />
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    </div>
  );
}

function Row({ item }: { item: HomeBankHealthItem }) {
  const t = useTranslations("home");
  const tBanks = useTranslations("banks");
  const labels = useFormatterLabels();
  const { provider, providerName, status, lastSyncAt, lastSuccessAt, errorMessage } = item;
  const info = BANK_PROVIDERS.find((p) => p.id === provider);
  const name = translateProviderName(provider, providerName, tBanks);

  let sub: string;
  if (status === "error") {
    sub = lastSuccessAt
      ? t("lastSyncedWhen", { when: formatLastSync(lastSuccessAt, labels) })
      : t("lastAttemptFailed");
  } else if (status === "never") {
    sub = t("notSyncedYet");
  } else {
    sub = t("bankTxnCount", { count: item.transactionCount });
  }

  const dot =
    status === "ok"
      ? "bg-status-on-track"
      : status === "never"
        ? "bg-muted-foreground/40"
        : "bg-status-heads-up";
  const statusText =
    status === "error"
      ? t("needsYou")
      : status === "never"
        ? t("statusNeverSynced")
        : formatLastSync(lastSyncAt, labels);

  return (
    <Link
      href="/settings/bank"
      title={parseSyncError(errorMessage)?.summary}
      className="-mx-2 grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/50"
    >
      <ProviderBadge
        color={info?.color ?? "var(--muted-foreground)"}
        name={name}
        domain={info?.domain}
        size={28}
        radius={8}
      />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium">{name}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div>
      </div>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground",
          status === "error" && cn("font-medium", AMBER_INK)
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
        {statusText}
      </span>
    </Link>
  );
}
