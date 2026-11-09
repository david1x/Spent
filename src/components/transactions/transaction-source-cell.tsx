"use client";

import { useTranslations } from "next-intl";
import { ProviderBadge } from "@/components/setup/provider-badge";
import { translateProviderName } from "@/lib/i18n-data";
import { BANK_PROVIDERS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { accountTailText } from "@/lib/account-tail";

interface TransactionSourceCellProps {
  provider: string;
  accountLabel: string | null;
}

export function getAccountDisplayLabel(
  providerName: string,
  accountLabel: string | null
): { primary: string; secondary: string | null } {
  const labelDistinct =
    accountLabel != null &&
    accountLabel.trim() !== "" &&
    accountLabel.trim().toLowerCase() !== providerName.trim().toLowerCase();
  return {
    primary: labelDistinct ? accountLabel.trim() : providerName,
    secondary: labelDistinct ? providerName : null,
  };
}

export function TransactionSourceCell({
  provider,
  accountLabel,
}: TransactionSourceCellProps) {
  const tBanks = useTranslations("banks");
  const info = BANK_PROVIDERS.find((b) => b.id === provider);
  const providerName = translateProviderName(
    provider,
    info?.name ?? provider,
    tBanks
  );

  const { primary, secondary } = getAccountDisplayLabel(providerName, accountLabel);
  const tooltip = secondary ? `${primary} · ${secondary}` : primary;

  return (
    <div className="flex min-w-0 items-center gap-2" title={tooltip}>
      {info ? (
        <ProviderBadge
          color={info.color}
          name={providerName}
          domain={info.domain}
          size={20}
          radius={6}
        />
      ) : (
        <div className="h-5 w-5 shrink-0 rounded-md bg-muted" aria-hidden />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm leading-tight">{primary}</div>
        {secondary ? (
          <div className="truncate text-xs text-muted-foreground">{secondary}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Last four digits, plus the currency of a foreign-currency account ("6789 USD"). */
export function lastFourDigits(accountNumber: string | null | undefined): string | null {
  return accountTailText(accountNumber);
}

interface AccountMarkProps {
  provider: string;
  accountLabel: string | null;
  accountNumber?: string | null;
  size?: "sm" | "md";
  /** Hide the account name and keep only the mark and digits (tight rows). */
  hideLabel?: boolean;
  className?: string;
}

/**
 * Bank mark, short account name and the last four digits, e.g. "Cal ••4821".
 * The digits tell apart two logins or cards at the same bank.
 */
export function AccountMark({
  provider,
  accountLabel,
  accountNumber,
  size = "md",
  hideLabel = false,
  className,
}: AccountMarkProps) {
  const tBanks = useTranslations("banks");
  const t = useTranslations("transactions");
  const info = BANK_PROVIDERS.find((b) => b.id === provider);
  const providerName = translateProviderName(provider, info?.name ?? provider, tBanks);
  const { primary } = getAccountDisplayLabel(providerName, accountLabel);
  const last4 = lastFourDigits(accountNumber);
  const badgeSize = size === "sm" ? 16 : 20;
  const title = last4 ? t("accountEndingIn", { account: primary, digits: last4 }) : primary;

  return (
    <span
      className={cn("flex min-w-0 items-center gap-2 whitespace-nowrap", className)}
      title={title}
    >
      {info ? (
        <ProviderBadge
          color={info.color}
          name={providerName}
          domain={info.domain}
          size={badgeSize}
          radius={size === "sm" ? 4 : 6}
        />
      ) : (
        <span
          className="shrink-0 rounded-md bg-muted"
          style={{ width: badgeSize, height: badgeSize }}
          aria-hidden
        />
      )}
      <span className={hideLabel && last4 ? "sr-only" : "min-w-0 truncate"}>{primary}</span>
      {last4 ? (
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground" dir="ltr">
          ••{last4}
        </span>
      ) : null}
    </span>
  );
}
