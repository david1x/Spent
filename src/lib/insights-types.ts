/**
 * Shapes returned by GET /api/insights. Every number is computed by
 * src/server/insights; the page only formats them.
 */

export type RecurringCadence = "weekly" | "monthly" | "bimonthly" | "quarterly" | "annual";

/**
 * new: started recently. changed: the amount stepped. missing: an expected
 * charge hasn't arrived. cancelled: the user canceled it, so nothing is
 * expected. charged_after_cancel: canceled, yet charged again since.
 */
export type RecurringStatus = "active" | "new" | "changed" | "missing" | "cancelled" | "charged_after_cancel";

export interface RecurringSeries {
  /** Stable id, used for feedback ("not recurring"). */
  key: string;
  /** Display name: the latest raw merchant name. */
  merchant: string;
  /** Normalized merchant key the series was grouped by. */
  merchantKey: string;
  direction: "expense" | "income";
  cadence: RecurringCadence;
  /** Utilities and similar bills whose amount moves with usage. */
  variable: boolean;
  /** Typical amount per charge, positive. */
  typical: number;
  min: number;
  max: number;
  last: number;
  lastDate: string;
  firstDate: string;
  /** Expected next charge day (YYYY-MM-DD). */
  nextExpected: string;
  occurrences: number;
  /** Typical amount times charges per year. */
  annual: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  /** Bills with little room to shop around (utilities, arnona, health). */
  essential: boolean;
  /** False for transfers, savings and other rows left out of spending. */
  counted: boolean;
  status: RecurringStatus;
  change: { from: number; to: number; since: string } | null;
  /** The user set how often it bills. */
  userCadence: boolean;
  /** The user added it from a transaction; detection hadn't found it. */
  manual: boolean;
  /** Day the user marked it canceled. */
  cancelledAt: string | null;
  /** The first charge after it was canceled. */
  chargedAfterCancel: { date: string; amount: number } | null;
}

export interface ForecastRange {
  periodStart: string;
  periodEnd: string;
  dayOfPeriod: number;
  periodLength: number;
  /** Counted spending so far this period. */
  spent: number;
  /** Recurring charges and installments still expected before the period ends. */
  fixedRemaining: number;
  /** Likely period total: low (P20), mid (P50), high (P80) of past cycles' remaining variable spend. */
  low: number;
  mid: number;
  high: number;
  /** What the range is compared against. */
  target: number | null;
  targetSource: "target" | "budgets" | "typical" | null;
  /** Median total of past complete periods. */
  typical: number | null;
  /** Past periods the range was built from. */
  cyclesUsed: number;
  /** Totals of those past periods, oldest first. */
  history: Array<{ periodStart: string; periodEnd: string; total: number }>;
}

export interface CommittedPlan {
  merchant: string;
  amount: number;
  /** Payments left after this period. */
  remaining: number;
  /** Day of the last expected payment. */
  endsOn: string;
}

export interface CommittedPeriod {
  periodStart: string;
  periodEnd: string;
  /** The period we're in; amounts cover only what's due after today. */
  current: boolean;
  installments: number;
  recurring: number;
  plans: CommittedPlan[];
  /** Recurring charges expected in the period. */
  items: Array<{ merchant: string; amount: number; date: string; variable: boolean }>;
}

export type UpcomingKind = "recurring" | "installment" | "card_bill" | "income";

export interface UpcomingCharge {
  date: string;
  merchant: string;
  /** Positive. Income is flagged by `kind`. */
  amount: number;
  kind: UpcomingKind;
  /** Variable bills and projected installments are estimates. */
  estimated: boolean;
  seriesKey?: string;
}

export interface FeeLine {
  merchant: string;
  total: number;
  count: number;
  lastDate: string;
}

export interface FeesSummary {
  /** Bank and card fees, interest and similar charges in the last 12 months. */
  lines: FeeLine[];
  total12m: number;
  /** Purchases made in a foreign currency in the last 12 months, in shekels. */
  foreignSpend12m: number;
  foreignCount: number;
}

export interface RecapDriver {
  categoryId: number | null;
  name: string | null;
  color: string | null;
  amount: number;
  typical: number;
  delta: number;
}

export interface CycleRecap {
  periodStart: string;
  periodEnd: string;
  spent: number;
  typical: number | null;
  income: number;
  net: number;
  /** Categories that moved the total most against their typical cycle. */
  drivers: RecapDriver[];
  biggest: { id: number; merchant: string; amount: number; date: string } | null;
}

export interface IncomeInfo {
  merchant: string;
  seriesKey: string;
  typical: number;
  last: number;
  lastDate: string;
  /** Usual day of month it arrives. */
  expectedDay: number;
  /** received: already in this period. late: past its usual day. upcoming: not due yet. */
  status: "received" | "late" | "upcoming";
  /** Last payment against the typical one, as a fraction (0.08 = 8% more). */
  change: number | null;
}

export interface BudgetSuggestion {
  categoryId: number;
  name: string;
  color: string | null;
  /** Rounded up from the median. */
  suggested: number;
  median: number;
  /** Of the last six periods, how many had spending here. */
  activeCycles: number;
}

export interface MerchantMergeSuggestion {
  /** The recurring one; merging maps `b` onto it. */
  a: { key: string; name: string };
  b: { key: string; name: string };
}

export interface RefundItem {
  id: number;
  merchant: string;
  amount: number;
  date: string;
}

export type InsightType =
  | "price_up"
  | "price_down"
  | "new_recurring"
  | "missing_recurring"
  | "duplicate"
  | "forecast_over"
  | "forecast_under"
  | "budget_pace"
  | "unusual_category"
  | "large_charge"
  | "salary_late"
  | "salary_changed"
  | "installments_ending"
  | "fees"
  | "budget_suggest"
  | "refund"
  | "merchant_merge"
  | "charged_after_cancel";

export type InsightSeverity = "alert" | "warn" | "info" | "good";

export interface InsightLink {
  search?: string;
  categoryId?: number;
  from?: string;
  to?: string;
  /** Another page section instead of Transactions. */
  anchor?: "recurring" | "upcoming" | "committed" | "fees" | "budgets" | "merge";
}

export interface Insight {
  /** Stable id: dismissing it hides this exact finding. */
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  /** Shekel impact times urgency times confidence; the feed is sorted by it. */
  score: number;
  /** Values for the type's message. Strings are names or ISO days; numbers are amounts or counts. */
  params: Record<string, string | number | null>;
  link?: InsightLink;
  /** Detection-level feedback this insight offers ("not recurring", "not unusual"). */
  feedback?: { key: string; action: "not_recurring" | "not_unusual" };
}

export interface InsightsPayload {
  generatedAt: string;
  /** Days of history available, so the page can explain thin results. */
  historyDays: number;
  forecast: ForecastRange | null;
  committed: CommittedPeriod[];
  feed: Insight[];
  /** Insights hidden by dismiss or snooze. */
  hiddenCount: number;
  recurring: RecurringSeries[];
  upcoming: UpcomingCharge[];
  fees: FeesSummary;
  recap: CycleRecap | null;
  income: IncomeInfo | null;
  budgetSuggestions: BudgetSuggestion[];
  mergeSuggestions: MerchantMergeSuggestion[];
  refunds: RefundItem[];
  ai: { provider: "claude" | "ollama" | null };
}
