"use client";

import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/lib/api";
import type { Locale } from "@/i18n/routing";
import {
  formatPeriodLabel,
  periodContaining,
  periodRange,
  periodStartDay,
  type Period,
} from "@/lib/period";

/**
 * The budget period containing `date`: a calendar month, or payday to payday
 * when the user runs budgets that way (Settings > General). Pages pass the
 * resulting from/to to the API so client and server agree on the range.
 */
export function useBudgetPeriod(
  date: Date,
  locale?: Locale
): { period: Period; from: string; to: string; label: string } {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });
  const startDay = settings ? periodStartDay(settings.budgetPeriod, settings.paydayDay) : 1;
  const period = periodContaining(date, startDay);
  return { period, ...periodRange(period), label: formatPeriodLabel(period, locale) };
}
