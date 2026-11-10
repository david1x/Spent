import "server-only";

import { createAIProvider } from "../ai/factory";
import type { InsightsPayload } from "@/lib/insights-types";

/**
 * The AI only words what the engine already computed: it gets the figures on
 * the page (amounts, categories, merchant names), never raw transactions,
 * and is told not to add numbers of its own.
 */
export async function summarizeInsights(payload: InsightsPayload, locale: "he" | "en"): Promise<string> {
  const provider = createAIProvider();
  if (!provider) throw new Error("No AI provider is set up");

  const language = locale === "he" ? "Hebrew" : "English";
  const system = [
    "You are a careful personal-finance assistant inside Spent, a budgeting app for people in Israel.",
    `Write in ${language}.`,
    "Use only the facts in the JSON you are given. Never invent amounts, dates, merchants or percentages, and don't add up figures yourself unless both are given.",
    "Amounts are Israeli shekels; write them like ₪1,250.",
    "Be specific and practical. No generic money tips, no judgment, no greetings.",
    "Format: one short sentence on how the period is going, then 3 to 5 lines that each start with \"- \" and name one concrete thing to check or do, most important first.",
    "Plain text only: no headings, bold or tables. Under 140 words.",
  ].join(" ");

  const facts = {
    today: payload.generatedAt.slice(0, 10),
    period: payload.forecast && {
      start: payload.forecast.periodStart,
      end: payload.forecast.periodEnd,
      day: payload.forecast.dayOfPeriod,
      days: payload.forecast.periodLength,
      spentSoFar: payload.forecast.spent,
      stillExpectedFixed: payload.forecast.fixedRemaining,
      likelyTotal: { low: payload.forecast.low, high: payload.forecast.high },
      comparedTo: payload.forecast.target !== null ? { amount: payload.forecast.target, kind: payload.forecast.targetSource } : null,
    },
    findings: payload.feed.slice(0, 8).map((i) => ({ type: i.type, severity: i.severity, ...i.params })),
    recurring: payload.recurring
      .filter((s) => s.direction === "expense" && s.counted)
      .slice(0, 10)
      .map((s) => ({ merchant: s.merchant, cadence: s.cadence, amount: s.typical, perYear: s.annual, status: s.status, essentialBill: s.essential })),
    committedNextPeriods: payload.committed.filter((c) => !c.current).slice(0, 3).map((c) => ({ start: c.periodStart, installments: c.installments, recurring: c.recurring })),
    fees12Months: payload.fees.total12m,
    foreignSpend12Months: payload.fees.foreignSpend12m,
    lastPeriod: payload.recap && {
      start: payload.recap.periodStart,
      end: payload.recap.periodEnd,
      spent: payload.recap.spent,
      typical: payload.recap.typical,
      income: payload.recap.income,
      biggestChanges: payload.recap.drivers.map((d) => ({ category: d.name, amount: d.amount, typical: d.typical })),
    },
    salary: payload.income && { status: payload.income.status, usualDay: payload.income.expectedDay, typical: payload.income.typical, last: payload.income.last },
  };

  const text = await provider.complete(system, JSON.stringify(facts), { maxTokens: 700 });
  if (!text) throw new Error("The AI returned an empty answer");
  return text;
}
