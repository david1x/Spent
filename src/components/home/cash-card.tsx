"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { getCash } from "@/lib/api";
import type { CashAccount, CashEvent } from "@/lib/cash-types";
import { accountTailText } from "@/lib/account-tail";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { CardShell, CardSkeleton } from "./card-shell";
import { bcpFor, formatWhole, parseLocalDate } from "./home-format";

const SHOWN_EVENTS = 6;
const SHOWN_ACCOUNTS = 4;

/** SQLite's datetime('now') is UTC without a zone marker. */
const sqliteDate = (value: string) => new Date(value.replace(" ", "T") + "Z");

/**
 * Money, not spending: the bank balance now, what reaches the bank before
 * the period ends (card statements, recurring bills, salary), and what's
 * left after it. Card purchases count in spending on the day they're made,
 * but leave the bank only on the card's billing day.
 */
export function CashCard() {
  const t = useTranslations("home.cash");
  const { data, isLoading } = useQuery({ queryKey: ["home", "cash"], queryFn: getCash });

  if (isLoading) return <CardSkeleton label={t("label")} height={220} />;
  if (!data) return null;
  const hasBalance = data.accounts.length > 0;
  if (!data.hasBank && data.events.length + data.later.length === 0) return null;

  return (
    <CardShell label={data.hasBank ? t("label") : t("labelCards")}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-8">
        {data.hasBank ? (
          <Balance
            accounts={data.accounts}
            available={data.available}
            savings={data.savings}
            asOf={data.asOf}
            hasBalance={hasBalance}
          />
        ) : null}
        <Timeline
          events={data.events}
          later={data.later}
          periodEnd={data.periodEnd}
          projected={hasBalance ? data.projected : null}
          projectedAfterLater={hasBalance ? data.projectedAfterLater : null}
          wide={!data.hasBank}
        />
      </div>
    </CardShell>
  );
}

function Balance({
  accounts,
  available,
  savings,
  asOf,
  hasBalance,
}: {
  accounts: CashAccount[];
  available: number;
  savings: number;
  asOf: string | null;
  hasBalance: boolean;
}) {
  const t = useTranslations("home.cash");
  const locale = useLocale() as Locale;
  const format = useFormatter();
  const [showAll, setShowAll] = useState(false);

  if (!hasBalance) {
    return <p className="text-sm text-muted-foreground text-pretty">{t("noBalance")}</p>;
  }
  const shown = showAll ? accounts : accounts.slice(0, SHOWN_ACCOUNTS);
  return (
    <div className="min-w-0">
      <div className="font-serif text-[2.25rem] leading-none tabular-nums">
        <bdi dir="ltr">
          {available < 0 ? "−" : ""}
          {formatWhole(available, locale)}
        </bdi>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {asOf ? t("asOf", { when: format.relativeTime(sqliteDate(asOf), new Date()) }) : null}
        {savings > 0 ? ` · ${t("savingsLine", { amount: formatWhole(savings, locale) })}` : null}
      </p>
      <ul className="mt-4 divide-y divide-border border-t border-border text-[13px]">
        {shown.map((a) => (
          <li key={`${a.credentialId}-${a.accountNumber}`} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate">
              <bdi>{a.label?.trim() || a.provider}</bdi>
              <span className="ms-1.5 text-[11.5px] text-muted-foreground tabular-nums">
                <bdi dir="ltr">{accountTailText(a.accountNumber)}</bdi>
              </span>
              {a.savings ? (
                <span className="ms-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                  {t("savingsTag")}
                </span>
              ) : null}
            </span>
            <span className={cn("shrink-0 text-end tabular-nums", a.savings && "text-muted-foreground")}>
              <bdi dir="ltr">
                {a.balance < 0 ? "−" : ""}
                {a.currency === "ILS" ? formatWhole(a.balance, locale) : formatCurrency(a.balance, a.currency, locale)}
              </bdi>
              {a.currency !== "ILS" ? (
                <span className="block text-[11px] text-muted-foreground">
                  <bdi dir="ltr">≈ {formatWhole(a.balanceIls, locale)}</bdi>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {accounts.length > SHOWN_ACCOUNTS ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? t("showLess") : t("showAll", { count: accounts.length })}
        </button>
      ) : null}
    </div>
  );
}

function Timeline({
  events,
  later,
  periodEnd,
  projected,
  projectedAfterLater,
  wide,
}: {
  events: CashEvent[];
  later: CashEvent[];
  periodEnd: string;
  projected: number | null;
  projectedAfterLater: number | null;
  wide: boolean;
}) {
  const t = useTranslations("home.cash");
  const locale = useLocale() as Locale;
  const [showAll, setShowAll] = useState(false);
  const day = (iso: string) => parseLocalDate(iso).toLocaleDateString(bcpFor(locale), { day: "numeric", month: "short" });
  const shown = showAll ? events : events.slice(0, SHOWN_EVENTS);
  const due = events.reduce((s, e) => s + e.amount, 0);

  return (
    <div className={cn("min-w-0", wide && "lg:col-span-2")}>
      <h4 className="text-[12.5px] font-semibold">{t("untilEnd", { date: day(periodEnd) })}</h4>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("nothingDue")}</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-border text-[13px]">
          {shown.map((e, i) => (
            <EventRow key={`${e.date}-${e.label}-${i}`} event={e} day={day(e.date)} />
          ))}
        </ul>
      )}
      {events.length > SHOWN_EVENTS ? (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? t("showLess") : t("showAll", { count: events.length })}
        </button>
      ) : null}

      <div className="mt-3 border-t border-border pt-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
          <span className="text-[13.5px]">
            {projected !== null ? t("expectedOn", { date: day(periodEnd) }) : t("dueBefore", { date: day(periodEnd) })}
          </span>
          <span className="font-serif text-[1.5rem] leading-none tabular-nums">
            <bdi dir="ltr">
              {(projected ?? due) < 0 ? "−" : projected === null && due > 0 ? "+" : ""}
              {formatWhole(projected ?? due, locale)}
            </bdi>
          </span>
        </div>
        {projected !== null && projected < 0 ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-status-over" aria-hidden />
            {t("belowZero")}
          </p>
        ) : null}
      </div>

      {later.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-[12.5px] font-semibold">{t("earlyNext")}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("earlyNextHint")}</p>
          <ul className="mt-1.5 divide-y divide-border text-[13px]">
            {later.map((e, i) => (
              <EventRow key={`later-${e.date}-${e.label}-${i}`} event={e} day={day(e.date)} />
            ))}
          </ul>
          {projectedAfterLater !== null ? (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 text-[13px]">
              <span className="text-muted-foreground">{t("afterThem")}</span>
              <span className="font-medium tabular-nums">
                <bdi dir="ltr">
                  {projectedAfterLater < 0 ? "−" : ""}
                  {formatWhole(projectedAfterLater, locale)}
                </bdi>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event, day }: { event: CashEvent; day: string }) {
  const t = useTranslations("home.cash");
  const locale = useLocale() as Locale;
  const tail = event.card ? accountTailText(event.card.accountNumber) : null;
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="w-12 shrink-0 text-[11.5px] leading-tight text-muted-foreground tabular-nums">
        {day}
        {event.late ? <span className="block text-[10px] font-medium text-status-over">{t("late")}</span> : null}
      </span>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          event.kind === "income" ? "bg-status-on-track" : event.kind === "card_bill" ? "bg-foreground/70" : "bg-foreground/30"
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        <bdi>{event.label}</bdi>
        {tail ? (
          <span className="ms-1.5 text-[11.5px] text-muted-foreground tabular-nums">
            <bdi dir="ltr">{tail}</bdi>
          </span>
        ) : null}
        {event.card ? (
          <span className="ms-1.5 hidden text-[11.5px] text-muted-foreground sm:inline">
            {event.card.open ? t("cardSoFar", { count: event.card.count }) : t("cardCount", { count: event.card.count })}
          </span>
        ) : null}
      </span>
      <span className={cn("shrink-0 text-end font-medium tabular-nums", event.kind === "income" && "text-primary")}>
        <bdi dir="ltr">
          {event.estimated ? "≈ " : ""}
          {event.amount < 0 ? "−" : "+"}
          {formatWhole(event.amount, locale)}
        </bdi>
      </span>
    </li>
  );
}
