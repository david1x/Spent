"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, CalendarClock, MoreHorizontal, RotateCcw, X } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import type {
  BudgetSuggestion,
  CycleRecap,
  FeesSummary,
  IncomeInfo,
  MerchantMergeSuggestion,
  RecurringSeries,
  UpcomingCharge,
} from "@/lib/insights-types";
import {
  mergeMerchants,
  sendInsightFeedback,
  setRecurringCadence,
  setRecurringCancelled,
  updateBudget,
  updateCategoryBudgetMode,
} from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardShell } from "@/components/home/card-shell";
import { INCOME_INK } from "@/components/transactions/summary-strip";
import { bcpFor, parseLocalDate } from "@/components/home/home-format";
import { cn } from "@/lib/utils";
import { cadenceLabel, day, isolate, money } from "./insight-format";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
const PILL_TONE = {
  neutral: "bg-muted text-muted-foreground",
  amber: "bg-[color-mix(in_oklch,var(--status-heads-up)_20%,var(--card))] text-[color-mix(in_oklch,var(--status-heads-up)_55%,var(--foreground))]",
  green: "bg-[color-mix(in_oklch,var(--status-on-track)_18%,var(--card))] text-[color-mix(in_oklch,var(--status-on-track)_55%,var(--foreground))]",
  blue: "bg-[color-mix(in_oklch,var(--status-plenty-left)_18%,var(--card))] text-[color-mix(in_oklch,var(--status-plenty-left)_55%,var(--foreground))]",
  red: "bg-[color-mix(in_oklch,var(--status-over)_16%,var(--card))] text-[color-mix(in_oklch,var(--status-over)_60%,var(--foreground))]",
};

/** The next 30 days, by date. */
export function UpcomingCard({ items }: { items: UpcomingCharge[] }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const byDate = new Map<string, UpcomingCharge[]>();
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);
  const outgoing = items.filter((i) => i.kind !== "income" && i.kind !== "card_bill").reduce((s, i) => s + i.amount, 0);

  return (
    <CardShell label={t("upcoming.label")} action={items.length > 0 ? t("upcoming.total", { amount: money(outgoing, locale) }) : undefined}>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("upcoming.empty")}</p>
      ) : (
        <ol className="space-y-3">
          {[...byDate.entries()].slice(0, 14).map(([date, list]) => {
            const d = parseLocalDate(date);
            return (
              <li key={date} className="flex gap-3">
                <div className="w-11 shrink-0 pt-0.5 text-center">
                  <div className="text-[17px] leading-none font-semibold tabular-nums">{d.getDate()}</div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {d.toLocaleDateString(bcpFor(locale), { weekday: "short" })}
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5 border-s border-border ps-3">
                  {list.map((i, n) => (
                    <li key={`${i.merchant}-${n}`} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">
                        <bdi>{i.kind === "card_bill" ? t("upcoming.cardBill", { card: i.merchant }) : i.merchant}</bdi>
                      </span>
                      <span className={cn(pill, i.kind === "income" ? PILL_TONE.green : i.kind === "installment" ? PILL_TONE.blue : PILL_TONE.neutral)}>
                        {t(`upcoming.kind.${i.kind}` as "upcoming.kind.recurring")}
                      </span>
                      <span
                        className="w-[5.5rem] shrink-0 text-end font-medium tabular-nums"
                        style={i.kind === "income" ? { color: INCOME_INK } : undefined}
                      >
                        <bdi>
                          {i.estimated ? "≈ " : ""}
                          {i.kind === "income" ? "+" : ""}
                          {money(i.amount, locale)}
                        </bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
      {items.some((i) => i.kind === "card_bill") ? (
        <p className="mt-3 text-[11.5px] text-muted-foreground">{t("upcoming.cardBillNote")}</p>
      ) : null}
    </CardShell>
  );
}

type Group = "subscriptions" | "bills" | "income" | "transfers" | "cancelled";

function groupOf(s: RecurringSeries): Group {
  if (s.cancelledAt) return "cancelled";
  if (s.direction === "income") return "income";
  if (!s.counted) return "transfers";
  return s.essential || s.variable ? "bills" : "subscriptions";
}

const STATUS_TONE: Record<RecurringSeries["status"], keyof typeof PILL_TONE> = {
  active: "neutral",
  new: "blue",
  changed: "amber",
  missing: "amber",
  cancelled: "neutral",
  charged_after_cancel: "red",
};

const CADENCE_OPTIONS: RecurringSeries["cadence"][] = ["weekly", "monthly", "bimonthly", "quarterly", "annual"];

function seriesTarget(s: RecurringSeries) {
  return { key: s.key, merchantKey: s.merchantKey, direction: s.direction === "expense" ? ("out" as const) : ("in" as const) };
}

function StatusPill({ s }: { s: RecurringSeries }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  let label: string;
  if (s.status === "charged_after_cancel" && s.chargedAfterCancel) {
    label = t("recurring.status.chargedAfterCancel", { date: day(s.chargedAfterCancel.date, locale) });
  } else if (s.status === "cancelled" && s.cancelledAt) {
    label = t("recurring.status.cancelledOn", { date: day(s.cancelledAt, locale) });
  } else if (s.status === "changed" && s.change) {
    label = t("recurring.status.changedTo", { from: money(s.change.from, locale), to: money(s.change.to, locale) });
  } else if (s.manual && s.status !== "missing") {
    label = t("recurring.status.manual");
  } else {
    label = t(`recurring.status.${s.status}` as "recurring.status.active");
  }
  return <span className={cn(pill, PILL_TONE[STATUS_TONE[s.status]])}>{label}</span>;
}

/** Frequency, canceled, not recurring: the user's say on one series. */
function RecurringMenu({ s }: { s: RecurringSeries }) {
  const t = useTranslations("insights");
  const queryClient = useQueryClient();
  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ["insights"] });
    toast.success(message);
  };
  const cadence = useMutation({
    mutationFn: (c: RecurringSeries["cadence"] | "auto") => setRecurringCadence(seriesTarget(s), c),
    onSuccess: (_d, c) => done(c === "auto" ? t("toast.cadenceAuto") : t("toast.cadenceSet", { cadence: t(`cadenceName.${c}` as "cadenceName.monthly") })),
    onError: () => toast.error(t("toast.failed")),
  });
  const cancel = useMutation({
    mutationFn: (cancelled: boolean) => setRecurringCancelled(seriesTarget(s), cancelled),
    onSuccess: (_d, cancelled) => done(cancelled ? t("toast.cancelled", { merchant: s.merchant }) : t("toast.reactivated")),
    onError: () => toast.error(t("toast.failed")),
  });
  const notRecurring = useMutation({
    mutationFn: () => sendInsightFeedback(s.key, "not_recurring"),
    onSuccess: () => done(t("toast.not_recurring")),
  });
  const value = s.userCadence ? s.cadence : "auto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("recurring.more", { merchant: s.merchant })}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CalendarClock className="h-3.5 w-3.5" />
            <span className="flex-1">{t("recurring.menu.billed")}</span>
            <span className="text-xs text-muted-foreground">{t(`cadenceName.${s.cadence}` as "cadenceName.monthly")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuRadioGroup value={value} onValueChange={(v) => cadence.mutate(v as RecurringSeries["cadence"] | "auto")}>
              <DropdownMenuRadioItem value="auto">{t("recurring.menu.auto")}</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {CADENCE_OPTIONS.map((c) => (
                <DropdownMenuRadioItem key={c} value={c}>
                  {t(`cadenceName.${c}` as "cadenceName.monthly")}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {s.cancelledAt ? (
          <DropdownMenuItem onClick={() => cancel.mutate(false)}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("recurring.menu.reactivate")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => cancel.mutate(true)}>
            <Ban className="h-3.5 w-3.5" />
            {t("recurring.menu.cancel")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => notRecurring.mutate()}>
          <X className="h-3.5 w-3.5" />
          {t("feed.not_recurring")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AmountCell({ s }: { s: RecurringSeries }) {
  const locale = useLocale() as Locale;
  return (
    <bdi dir="ltr">
      {s.variable ? `${money(s.min, locale)}–${money(s.max, locale)}` : money(s.typical, locale)}
    </bdi>
  );
}

/** Every recurring charge and deposit, with its yearly cost. */
export function RecurringCard({ series }: { series: RecurringSeries[] }) {
  const t = useTranslations("insights");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const groups: Group[] = ["subscriptions", "bills", "income", "transfers", "cancelled"];
  const yearlyOut = series
    .filter((s) => s.direction === "expense" && s.counted && !s.cancelledAt)
    .reduce((sum, s) => sum + s.annual, 0);
  const cadenceLine = (s: RecurringSeries) =>
    s.userCadence ? t("recurring.cadenceSetByYou", { cadence: cadenceLabel(s.cadence, t) }) : cadenceLabel(s.cadence, t);
  const nextCell = (s: RecurringSeries) => (s.cancelledAt ? "–" : day(s.nextExpected, locale));

  return (
    <CardShell
      label={t("recurring.label")}
      action={series.length > 0 ? t("recurring.yearly", { amount: money(yearlyOut, locale) }) : undefined}
    >
      {series.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("recurring.empty")}</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const list = series.filter((s) => groupOf(s) === g);
            if (list.length === 0) return null;
            const groupYearly = list.reduce((sum, x) => sum + x.annual, 0);
            return (
              <section key={g}>
                <h4 className="mb-1 flex items-baseline justify-between gap-3 text-[12px] font-semibold text-muted-foreground">
                  <span>{t(`recurring.group.${g}` as "recurring.group.subscriptions")}</span>
                  <span className="font-normal tabular-nums">
                    {g === "cancelled"
                      ? t("recurring.cancelledSaves", { amount: money(groupYearly, locale) })
                      : t("recurring.groupYearly", { amount: money(groupYearly, locale) })}
                  </span>
                </h4>
                <ul className="divide-y divide-border sm:hidden">
                  {list.map((s) => (
                    <li key={s.key} className={cn("flex items-start gap-2 py-2.5 text-[13px]", s.status === "cancelled" && "opacity-70")}>
                      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: s.categoryColor ?? "var(--muted-foreground)" }} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/transactions?search=${encodeURIComponent(s.merchant)}`}
                          className="block truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <bdi>{s.merchant}</bdi>
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                          <span className="tabular-nums">
                            <AmountCell s={s} /> {cadenceLine(s)}
                          </span>
                          {!s.cancelledAt ? (
                            <>
                              <span>·</span>
                              <span>{t("recurring.nextShort", { date: day(s.nextExpected, locale) })}</span>
                            </>
                          ) : null}
                          {s.status !== "active" || s.manual ? <StatusPill s={s} /> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-end">
                        <div className="font-medium tabular-nums">
                          <bdi dir="ltr">{money(s.annual, locale)}</bdi>
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">{t("recurring.perYear")}</div>
                      </div>
                      <RecurringMenu s={s} />
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  {/* Fixed columns: the merchant takes what the numbers leave. */}
                  <table className="w-full min-w-[36rem] table-fixed text-[13px]">
                    <colgroup>
                      <col />
                      <col className="w-[9rem]" />
                      <col className="w-[6.5rem]" />
                      <col className="w-[5rem]" />
                      <col className="w-[9.5rem]" />
                      <col className="w-9" />
                    </colgroup>
                    <thead className="sr-only">
                      <tr>
                        <th>{t("recurring.col.merchant")}</th>
                        <th>{t("recurring.col.amount")}</th>
                        <th>{t("recurring.col.yearly")}</th>
                        <th>{t("recurring.col.next")}</th>
                        <th>{t("recurring.col.status")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.map((s) => (
                        <tr key={s.key} className={cn("group", s.status === "cancelled" && "opacity-70")}>
                          <td className="py-2 pe-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="size-2 shrink-0 rounded-full" style={{ background: s.categoryColor ?? "var(--muted-foreground)" }} aria-hidden />
                              <Link
                                href={`/transactions?search=${encodeURIComponent(s.merchant)}`}
                                className="truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <bdi>{s.merchant}</bdi>
                              </Link>
                            </div>
                            <div className="ms-4 truncate text-[11.5px] text-muted-foreground">
                              {s.categoryName ? translateCategoryName(s.categoryName, tCat) : null}
                              {s.categoryName ? " · " : null}
                              {t("recurring.since", { date: day(s.firstDate, locale) })}
                            </div>
                          </td>
                          <td className="py-2 pe-3 text-end whitespace-nowrap tabular-nums">
                            <AmountCell s={s} />
                            <div className="truncate text-[11.5px] text-muted-foreground">{cadenceLine(s)}</div>
                          </td>
                          <td className="py-2 pe-3 text-end font-medium whitespace-nowrap tabular-nums">
                            <bdi dir="ltr">{money(s.annual, locale)}</bdi>
                            <div className="text-[11.5px] font-normal text-muted-foreground">{t("recurring.perYear")}</div>
                          </td>
                          <td className="py-2 pe-3 text-end whitespace-nowrap text-muted-foreground tabular-nums">{nextCell(s)}</td>
                          <td className="py-2 pe-1 text-end">
                            <StatusPill s={s} />
                          </td>
                          <td className="py-2 text-end">
                            <RecurringMenu s={s} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          <p className="text-[11.5px] text-muted-foreground">{t("recurring.note")}</p>
        </div>
      )}
    </CardShell>
  );
}

/** The last complete period against the ones before it. */
export function RecapCard({ recap }: { recap: CycleRecap }) {
  const t = useTranslations("insights");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const diff = recap.typical !== null && recap.typical > 0 ? recap.spent / recap.typical - 1 : null;

  return (
    <CardShell label={t("recap.label", { from: day(recap.periodStart, locale), to: day(recap.periodEnd, locale) })}>
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("recap.spent")} value={money(recap.spent, locale)} sub={diff !== null ? t("recap.vsTypical", { pct: `${diff >= 0 ? "+" : "−"}${Math.abs(Math.round(diff * 100))}%` }) : undefined} />
        <Stat label={t("recap.income")} value={money(recap.income, locale)} />
        <Stat label={t("recap.net")} value={`${recap.net < 0 ? "−" : "+"}${money(Math.abs(recap.net), locale)}`} />
      </div>
      {recap.drivers.length > 0 ? (
        <>
          <h4 className="mt-4 mb-1 text-[12px] font-semibold text-muted-foreground">{t("recap.drivers")}</h4>
          <ul className="divide-y divide-border text-[13px]">
            {recap.drivers.map((d) => (
              <li key={d.categoryId ?? d.name} className="flex items-center gap-2 py-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: d.color ?? "var(--muted-foreground)" }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{d.name ? translateCategoryName(d.name, tCat) : t("recap.uncategorized")}</span>
                <span className="text-muted-foreground tabular-nums">
                  <bdi>{money(d.amount, locale)}</bdi>
                </span>
                <span className={cn("w-20 text-end font-medium tabular-nums", d.delta > 0 ? "text-[color-mix(in_oklch,var(--status-over)_70%,var(--foreground))]" : "text-[color-mix(in_oklch,var(--status-on-track)_60%,var(--foreground))]")}>
                  <bdi>
                    {d.delta > 0 ? "+" : "−"}
                    {money(Math.abs(d.delta), locale)}
                  </bdi>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {recap.biggest ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {t.rich("recap.biggest", {
            merchant: isolate(recap.biggest.merchant),
            amount: money(recap.biggest.amount, locale),
            b: (c) => <b className="font-medium text-foreground">{c}</b>,
          })}
        </p>
      ) : null}
    </CardShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[1.125rem] font-semibold tracking-tight tabular-nums">
        <bdi>{value}</bdi>
      </div>
      {sub ? <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Bank and card fees over 12 months, and what foreign purchases may cost on top. */
export function FeesCard({ fees }: { fees: FeesSummary }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  return (
    <CardShell label={t("fees.label")}>
      <div className="text-[1.5rem] leading-none font-semibold tracking-tight tabular-nums">
        <bdi>{money(fees.total12m, locale)}</bdi>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{t("fees.subtitle")}</p>
      {fees.lines.length > 0 ? (
        <ul className="mt-3 divide-y divide-border text-[13px]">
          {fees.lines.slice(0, 5).map((l) => (
            <li key={l.merchant} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                <bdi>{l.merchant}</bdi>
              </span>
              <span className="text-[11.5px] text-muted-foreground">{t("fees.times", { count: l.count })}</span>
              <span className="w-16 text-end font-medium tabular-nums">
                <bdi>{money(l.total, locale)}</bdi>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">{t("fees.none")}</p>
      )}
      {fees.foreignSpend12m > 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {t("fees.foreign", {
            amount: money(fees.foreignSpend12m, locale),
            count: fees.foreignCount,
            low: money(fees.foreignSpend12m * 0.025, locale),
            high: money(fees.foreignSpend12m * 0.035, locale),
          })}
        </p>
      ) : null}
      <p className="mt-2 text-[11.5px] text-muted-foreground">{t("fees.tip")}</p>
    </CardShell>
  );
}

/** The main income: has it arrived, and did it change. */
export function IncomeCard({ income }: { income: IncomeInfo }) {
  const t = useTranslations("insights");
  const locale = useLocale() as Locale;
  const tone = income.status === "received" ? PILL_TONE.green : income.status === "late" ? PILL_TONE.amber : PILL_TONE.neutral;
  return (
    <CardShell label={t("income.label")}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] font-medium">
          <bdi>{income.merchant}</bdi>
        </span>
        <span className={cn(pill, tone)}>{t(`income.status.${income.status}` as "income.status.received")}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label={t("income.last")} value={money(income.last, locale)} sub={day(income.lastDate, locale)} />
        <Stat
          label={t("income.typical")}
          value={money(income.typical, locale)}
          sub={income.change !== null ? t("income.change", { pct: `${income.change > 0 ? "+" : "−"}${Math.round(Math.abs(income.change) * 100)}%` }) : undefined}
        />
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">{t("income.usually", { day: income.expectedDay })}</p>
    </CardShell>
  );
}

/** Budgets from typical spending, one click each. */
export function BudgetSuggestionsCard({ items }: { items: BudgetSuggestion[] }) {
  const t = useTranslations("insights");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const [done, setDone] = useState<Set<number>>(new Set());
  const apply = useMutation({
    mutationFn: async (s: BudgetSuggestion) => {
      await updateCategoryBudgetMode(s.categoryId, "budgeted");
      await updateBudget(s.categoryId, s.suggested);
      return s;
    },
    onSuccess: (s) => {
      setDone((prev) => new Set(prev).add(s.categoryId));
      for (const key of ["insights", "summary", "categories", "home"]) queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(t("budgets.set", { category: translateCategoryName(s.name, tCat), amount: money(s.suggested, locale) }));
    },
    onError: () => toast.error(t("toast.failed")),
  });

  return (
    <CardShell label={t("budgets.label")}>
      <p className="text-[12.5px] text-muted-foreground">{t("budgets.explain")}</p>
      <ul className="mt-3 divide-y divide-border text-[13px]">
        {items.map((s) => (
          <li key={s.categoryId} className="flex items-center gap-2 py-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{translateCategoryName(s.name, tCat)}</span>
            <span className="text-[11.5px] text-muted-foreground tabular-nums">{t("budgets.typical", { amount: money(s.median, locale) })}</span>
            <Button
              size="sm"
              variant={done.has(s.categoryId) ? "ghost" : "outline"}
              disabled={done.has(s.categoryId) || apply.isPending}
              onClick={() => apply.mutate(s)}
              className="w-24 shrink-0 tabular-nums"
            >
              {done.has(s.categoryId) ? t("budgets.done") : t("budgets.setButton", { amount: money(s.suggested, locale) })}
            </Button>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

/** Two names, one company: merging makes recurring detection more accurate. */
export function MergeCard({ items }: { items: MerchantMergeSuggestion[] }) {
  const t = useTranslations("insights");
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (v: { s: MerchantMergeSuggestion; dismiss: boolean }) => mergeMerchants(v.s.b.key, v.s.a.key, v.dismiss),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success(v.dismiss ? t("merge.kept") : t("merge.merged"));
    },
    onError: () => toast.error(t("toast.failed")),
  });
  return (
    <CardShell label={t("merge.label")}>
      <p className="text-[12.5px] text-muted-foreground">{t("merge.explain")}</p>
      <ul className="mt-3 space-y-2">
        {items.map((s) => (
          <li key={`${s.a.key}|${s.b.key}`} className="rounded-lg border border-border p-3">
            <div className="flex flex-col gap-0.5 text-[13px]">
              <bdi className="truncate font-medium">{s.a.name}</bdi>
              <bdi className="truncate text-muted-foreground">{s.b.name}</bdi>
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => act.mutate({ s, dismiss: false })} disabled={act.isPending}>
                {t("merge.merge")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ s, dismiss: true })} disabled={act.isPending}>
                {t("merge.notSame")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
