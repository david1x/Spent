"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDownLeft, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { translateCategoryName, translateProviderName } from "@/lib/i18n-data";
import type { Locale } from "@/i18n/routing";
import type { HomeRecentTransaction } from "@/lib/types";
import { transactionName } from "@/lib/transaction-name";
import { CardShell, CardAction } from "./card-shell";
import { categoryIconFor } from "./category-icon";
import { bcpFor, tintFor } from "./home-format";

interface Props {
  items: HomeRecentTransaction[];
}

interface DayGroup {
  key: string;
  date: Date;
  items: HomeRecentTransaction[];
  spent: number;
}

export function RecentTransactionsCard({ items }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;

  if (items.length === 0) {
    return (
      <CardShell label={t("recentActivity")}>
        <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
          {t("noTransactionsYet")}
        </div>
      </CardShell>
    );
  }

  const groups = groupByDay(items);

  return (
    <CardShell
      label={t("recentActivity")}
      action={<CardAction href="/transactions">{t("allTransactions")}</CardAction>}
    >
      <div className="flex flex-col">
        {groups.map((group, gi) => (
          <section key={group.key} aria-label={dayLabel(group.date)}>
            <div
              className={cn(
                "flex items-baseline justify-between gap-2.5 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground",
                gi === 0 ? "pt-0" : "pt-3"
              )}
            >
              <span>{dayLabel(group.date)}</span>
              {group.spent > 0 && (
                <span className="font-medium normal-case tracking-normal tabular-nums">
                  {formatCurrency(group.spent, "ILS", locale)}
                </span>
              )}
            </div>
            <ul className="divide-y divide-border">
              {group.items.map((txn) => (
                <li key={txn.id}>
                  <Row txn={txn} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </CardShell>
  );

  function dayLabel(date: Date): string {
    const formatted = date.toLocaleDateString(bcpFor(locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const today = startOfDay(new Date());
    const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
    if (diffDays === 0) return t("todayDay", { date: formatted });
    if (diffDays === 1) return t("yesterdayDay", { date: formatted });
    return formatted;
  }
}

function Row({ txn, locale }: { txn: HomeRecentTransaction; locale: Locale }) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const tBanks = useTranslations("banks");
  const isIncome = txn.kind === "income";
  const Icon = isIncome
    ? ArrowDownLeft
    : txn.categoryName
      ? categoryIconFor(txn.categoryIcon)
      : CircleHelp;
  const tile = isIncome
    ? "color-mix(in oklch, var(--status-on-track) 28%, var(--card))"
    : txn.isCounted
      ? tintFor(txn.categoryColor)
      : "var(--muted)";
  const category = txn.categoryName
    ? translateCategoryName(txn.categoryName, tCat)
    : t("uncategorized");
  const account = [
    translateProviderName(txn.provider, txn.providerName, tBanks),
    txn.accountLast4 ? `••${txn.accountLast4}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const amount = formatCurrency(txn.chargedAmount, txn.chargedCurrency ?? "ILS", locale);

  return (
    <Link
      href="/transactions"
      className="-mx-2 grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/50"
    >
      <span
        className="grid size-8 place-items-center rounded-[10px]"
        style={{ backgroundColor: tile }}
        aria-hidden
      >
        <Icon className="size-[15px] text-foreground/80" />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            "truncate text-[13.5px] font-medium leading-snug",
            !txn.isCounted && "text-muted-foreground"
          )}
        >
          <bdi>{transactionName(txn)}</bdi>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          {!txn.isCounted && (
            <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-muted px-1.5 text-[10.5px] font-medium">
              {t("notCounted")}
            </span>
          )}
          <span className="truncate">
            {category}
            {account && (
              <>
                {" · "}
                <bdi>{account}</bdi>
              </>
            )}
          </span>
        </div>
      </div>
      <span
        className={cn(
          "whitespace-nowrap text-end text-[13.5px] tabular-nums",
          isIncome ? "font-medium text-primary" : "font-medium text-foreground",
          !txn.isCounted && "font-normal text-muted-foreground"
        )}
      >
        {isIncome ? "+" : ""}
        {amount}
      </span>
    </Link>
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function groupByDay(items: HomeRecentTransaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const txn of items) {
    const date = startOfDay(new Date(txn.date));
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, date, items: [], spent: 0 };
      groups.push(group);
    }
    group.items.push(txn);
    if (txn.kind === "expense" && txn.isCounted) {
      group.spent += Math.abs(txn.chargedAmount);
    }
  }
  return groups;
}
