export interface Workspace {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: number;
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | null;
  description: string;
  memo: string | null;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  categoryId: number | null;
  categorySource: "ai" | "user" | null;
  aiConfidence: number | null;
  provider: string;
  credentialId: number | null;
  accountLabel: string | null;
  syncRunId: number;
  kind: "expense" | "income" | "transfer";
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string | null;
  categoryColor: string | null;
  isExcluded: boolean;
  /**
   * The shekel amount is an estimate: the card bills this foreign purchase in
   * its own currency and converts it only when charged.
   */
  chargedEstimated?: boolean;
  /** The user's own name for the row, shown instead of the bank's description. */
  displayName?: string | null;
  /** The user's note on the row. */
  note?: string | null;
  /**
   * True when the row counts toward spending/income totals: not a card bill or
   * own-account transfer, not excluded, and its category counts in spending.
   * Only set by the transaction list query.
   */
  isCounted?: boolean;
  /** When this bank debit settles a linked card statement: that card login label. */
  cardBillLabel?: string | null;
}

/** A purchase split into monthly card installments ("payment 3 of 12"). */
export interface InstallmentPlan {
  /** Installments in the plan, when the bank reports it. */
  total: number | null;
  /** The whole purchase, as a positive number. */
  purchaseAmount: number;
  currency: string;
  /** Highest installment already charged. */
  paidCount: number;
  /** Installment rows on record, by charge date. Early ones may predate the sync history. */
  payments: TransactionWithCategory[];
  /** Expected charges still to come, estimated from the last one. */
  /** Sat Nov  7 17:29:52 JST 2026 is the expected charge date. */
  upcoming: Array<{ number: number; date: string; amount: number }>;
  /** What is still to be charged, as a positive number. */
  remaining: number;
  /** The card credited the purchase back (a return). Nothing more is owed. */
  refund: { date: string; amount: number; transactionId: number } | null;
}

/** Everything the payment history sheet shows for one transaction. */
export interface TransactionHistory {
  transaction: TransactionWithCategory;
  plan: InstallmentPlan | null;
  /** Every row with the same merchant name, newest first. */
  merchant: {
    transactions: TransactionWithCategory[];
    /** All matching rows, which can exceed the rows returned. */
    count: number;
  };
}

/** Per-segment counts and totals for the Transactions list, ignoring the type segment. */
export interface TransactionListAggregates {
  counts: {
    all: number;
    spending: number;
    income: number;
    notCounted: number;
  };
  /** Counted outflows (completed rows), as a positive number. */
  spent: number;
  /** Counted inflows (completed rows). */
  income: number;
  /** Outflows left out of totals (completed rows), as a positive number. */
  notCounted: number;
  /**
   * Per raw `date` value for the visible rows (type segment applied). Clients
   * bucket these into local days, since stored dates are UTC instants.
   */
  days: { date: string; spent: number; income: number; notCounted: number }[];
}

export type CategoryKind = "expense" | "income";

export type BudgetMode = "budgeted" | "tracking";

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  color: string;
  icon: string | null;
  kind: CategoryKind;
  budgetMode: BudgetMode;
  description: string | null;
  /** False for categories that only move money around (Transfers by default). */
  countsInSpending: boolean;
}

export type CategoryViewMode = "collapsed" | "expanded";

export type BudgetSource = "own" | "rollup" | "leaf";

export interface SyncRun {
  id: number;
  provider: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  errorMessage: string | null;
  transactionsAdded: number;
  transactionsUpdated: number;
  scrapeFromDate: string;
  createdAt: string;
}

export interface MonthlySummary {
  month: string;
  amount: number;
}

export interface MerchantSummary {
  name: string;
  amount: number;
  count: number;
}

export interface CategoryBreakdown {
  categoryId: number;
  name: string;
  color: string;
  amount: number;
  count: number;
}

export type BudgetStatus =
  | "plenty-left"
  | "on-track"
  | "heads-up"
  | "over";

export interface CategoryWithData {
  categoryId: number;
  parentId: number | null;
  parentName: string | null;
  isParent: boolean;
  budgetSource: BudgetSource;
  childCount?: number;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string | null;
  budgetMode: BudgetMode;
  spent: number;
  transactionCount: number;
  topMerchant: string | null;
  budget: number;
  isAutoBudget: boolean;
  vsLastMonth: number | null;
  remaining: number;
  perDayRemaining: number | null;
  percentSpent: number;
  status: BudgetStatus;
  needsReviewCount: number;
  vsTypical: { typical: number; percentDiff: number } | null;
}

/** Spend in one top-level category (parent rollup or standalone leaf), now vs before. */
export interface CategoryChange {
  categoryId: number;
  name: string;
  color: string;
  current: number;
  previous: number;
}

export interface CategoryChanges {
  /**
   * True while the viewed period is still running: `previous` then covers
   * only the same number of days at the start of last period.
   */
  sameDays: boolean;
  /** The compared window, YYYY-MM-DD. */
  previousFrom: string;
  previousTo: string;
  rows: CategoryChange[];
}

/** One budget period (a month, or payday to payday) in the multi-month view. */
export interface TrendPeriod {
  from: string;
  to: string;
  /** Counted spending, the same total the month view's hero shows. */
  spent: number;
  income: number;
  /** The period containing today: its totals are still growing. */
  inProgress: boolean;
  /** Spending per top-level category id (a parent's children rolled into it). */
  byCategory: Record<string, number>;
  /** Spending with no category yet. */
  uncategorized: number;
}

export interface TrendCategory {
  categoryId: number;
  name: string;
  color: string;
  total: number;
  /** The category's monthly budget, 0 when it has none or only tracks. */
  monthlyBudget: number;
}

export interface SpendingTrend {
  periods: TrendPeriod[];
  /** Every top-level category with spending in the range, largest first. */
  categories: TrendCategory[];
  /** The workspace's monthly target, 0 when unset. */
  monthlyTarget: number;
}

export interface DashboardSummary {
  periodTotal: number;
  transactionCount: number;
  monthlySpend: MonthlySummary[];
  topMerchants: MerchantSummary[];
  categoryBreakdown: CategoryBreakdown[];
  categoriesWithData: CategoryWithData[];
  changes: CategoryChanges;
  totalBudget: number;
  budgetedSpent: number;
  overallPercentSpent: number;
  timeElapsedPercent: number;
  daysUntilPayday: number;
  paydayDay: number;
  todayLabel: string;
  monthLabel: string;
  pacePhrase: string;
  typicalMonthly: number | null;
}

export interface Budget {
  categoryId: number;
  monthlyAmount: number;
  isAuto: boolean;
}

export type HomeSection =
  | "thisMonth"
  | "cashFlow"
  | "categorySnapshot"
  | "historicalTrend"
  | "recentTransactions"
  | "topMerchants"
  | "needsAttention"
  | "bankHealth";

export type HomePaceStatus = "on" | "ahead" | "over";

export interface HomeThisMonth {
  spent: number;
  budget: number;
  pacePhrase: string;
  daysUntilPayday: number;
  timeElapsedPercent: number;
  monthLabel: string;
  /** First day of the current period, YYYY-MM-DD. */
  periodStart: string;
  /** 1-based day within the period that today falls on. */
  dayOfPeriod: number;
  periodLength: number;
  /** Where spending would be today if it tracked the budget evenly. 0 without a budget. */
  expectedByToday: number;
  /** Straight-line projection of spending to the end of the period. */
  projected: number;
  /** Null when there is no budget to pace against. */
  paceStatus: HomePaceStatus | null;
  /** Spending over the same number of days at the start of last period. Null without history. */
  lastPeriodSameDays: number | null;
  /** First day of last period, YYYY-MM-DD. */
  lastPeriodStart: string;
}

export interface HomeCashFlow {
  income: number;
  expenses: number;
  net: number;
  /** Outflows left out of `expenses`: card bills, own-account transfers, excluded rows. */
  notCounted: number;
  notCountedCount: number;
}

export interface HomeCategorySnapshotItem {
  categoryId: number;
  name: string;
  color: string;
  icon: string | null;
  spent: number;
  budget: number;
  percentSpent: number;
  /** Counted purchases this period, subcategories included. */
  count: number;
  /** Merchant with the most spend in this category this period. */
  topMerchant: string | null;
}

export interface HomeHistoricalTrendPoint {
  month: string;
  label: string;
  total: number;
  isCurrent: boolean;
  /** The period's first and last day (YYYY-MM-DD), for links to its transactions. */
  from: string;
  to: string;
}

export interface HomeRecentTransaction {
  id: number;
  date: string;
  description: string;
  /** The user's own name for it, when they gave one. */
  displayName?: string | null;
  chargedAmount: number;
  chargedCurrency: string | null;
  kind: "expense" | "income" | "transfer";
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  provider: string;
  providerName: string;
  /** Last four digits of the account or card number, when it has any. */
  accountLast4: string | null;
  /** False when the row is shown but left out of spending totals. */
  isCounted: boolean;
}

export interface HomeTopMerchant {
  name: string;
  total: number;
  count: number;
}

export interface HomeNeedsAttention {
  uncategorized: number;
  lowConfidence: number;
  flagged: number;
  /** Distinct transactions across the three groups; one row can be in several. */
  total: number;
}

export interface HomeBankHealthItem {
  provider: string;
  providerName: string;
  lastSyncAt: string | null;
  status: "ok" | "stale" | "error" | "never";
  errorMessage: string | null;
  /** Last run that did not fail, even when the latest one did. */
  lastSuccessAt: string | null;
  transactionCount: number;
}

export interface HomeSectionError {
  section: HomeSection;
  message: string;
}

export interface HomePayload {
  thisMonth: HomeThisMonth | null;
  cashFlow: HomeCashFlow | null;
  categorySnapshot: HomeCategorySnapshotItem[] | null;
  historicalTrend: HomeHistoricalTrendPoint[] | null;
  recentTransactions: HomeRecentTransaction[] | null;
  topMerchants: HomeTopMerchant[] | null;
  needsAttention: HomeNeedsAttention | null;
  bankHealth: HomeBankHealthItem[] | null;
  nextScheduledSync: string | null;
  errors: HomeSectionError[];
}

export type SyncKind = "manual" | "scheduled";

export interface ActivitySnapshot {
  sync: {
    active: boolean;
    since: string | null;
    kind: SyncKind | null;
    stale: boolean;
  };
  scheduler: {
    armed: boolean;
    nextRunAt: string | null;
  };
  ollama: {
    running: boolean;
    spawnedBySpent: boolean;
  };
}

export interface Integration {
  id: number;
  provider: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  transactionCount: number;
  /** True when the user has flagged this bank as needing manual 2FA (showBrowser fallback). */
  requiresManualTwoFactor: boolean;
  /** True when a long-term OTP token is already stored (programmatic 2FA banks only). */
  hasTwoFactorToken: boolean;
  /** Cards only: bank debits currently matched as this login's card bills. */
  matchedBillCount: number;
  /** Accounts seen under this login (for card logins, one per card), most active first. */
  accounts: { accountNumber: string; transactionCount: number }[];
  /** Banks only: cards linked to this bank as "Paid from". */
  linkedCardCount: number;
}

/** One card under a card login (a Cal user can hold several cards). */
export interface CardAccount {
  /** As reported by the card company; usually the last 4 digits. */
  accountNumber: string;
  purchaseCount: number;
  lastPurchaseAt: string;
  billingCycles: number;
  /** Bank login whose account pays this card's bill. */
  paidFromCredentialId: number | null;
  /** Bank debits currently matched as this card's bills. */
  matchedBills: number;
  /** For unlinked cards: the bank with the most debits matching this card's bills. */
  suggestion: { bankCredentialId: number; matchingBills: number } | null;
  /** Set when the card was moved to another workspace; its rows live there. */
  elsewhere: { workspaceId: number; workspaceName: string } | null;
}

/** One card under a card login, for choosing which cards sync and where they go. */
export interface LoginCard {
  accountNumber: string;
  /** The card company's name for it, when its list gives one. */
  label: string | null;
  active: boolean;
  syncEnabled: boolean;
  /** Seen in the card company's list (a card check or sync), not just in old transactions. */
  listed: boolean;
  transactionCount: number;
  /** Where its transactions go: its route, else the login's workspace. */
  workspaceId: number;
  workspaceName: string;
}

/** A card from another workspace's login that was moved into this one. */
export interface RoutedInCard {
  credentialId: number;
  provider: string;
  label: string;
  homeWorkspaceId: number;
  homeWorkspaceName: string;
  card: CardAccount;
}

export interface SetupStatus {
  isConfigured: boolean;
  hasBankCredentials: boolean;
  hasAIProvider: boolean;
}

export interface AppSettings {
  monthsToSync: number;
  aiProvider: "claude" | "ollama" | "none";
  ollamaUrl: string;
  ollamaModel: string;
  showBrowser: boolean;
  paydayDay: number;
  /** "payday": budget periods run from payday to the day before the next one. */
  budgetPeriod: "calendar" | "payday";
  monthlyTarget: number | null;
  autoSyncEnabled: boolean;
  autoSyncTime: string;
  language: "en" | "he";
}

export type BankProvider =
  | "isracard"
  | "cal"
  | "max"
  | "amex"
  | "hapoalim"
  | "leumi"
  | "mizrahi"
  | "discount"
  | "mercantile"
  | "beinleumi"
  | "otsarHahayal"
  | "union"
  | "pagi"
  | "yahav"
  | "massad"
  | "beyahadBishvilha"
  | "behatsdaa"
  | "oneZero";

export interface CredentialField {
  key: string;
  label: string;
  type: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  exactLength?: number;
  numeric?: boolean;
}

export type BankKind = "bank" | "card";

export interface BankProviderInfo {
  id: BankProvider;
  name: string;
  kind: BankKind;
  color: string;
  blurb: string;
  /** Domain used to fetch the favicon logo via Google's S2 API. */
  domain: string;
  credentialFields: CredentialField[];
  enabled: boolean;
  /**
   * True when the underlying scraper supports OTP-driven login flows that we
   * can drive in-process. Currently only OneZero — Hapoalim/Leumi/etc. expose
   * the methods on the base interface but no concrete implementation, so 2FA
   * on those banks falls back to the manual (showBrowser) path.
   */
  supportsProgrammaticTwoFactor?: boolean;
  /**
   * Set when the bank blocks automated sign-in and no scraper fix exists yet.
   * Sync skips these connections; transactions come in through file imports.
   * Remove the flag to turn sync back on.
   */
  syncPaused?: { issueUrl: string };
  /**
   * The card company lists the login's cards, so Spent can check for cards
   * quickly (no transactions) and sync chosen cards only.
   */
  listsCards?: boolean;
}

/** One row of an imported bank export, after the client mapped its columns. */
export interface ImportRow {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  description: string;
  /** Signed, in shekels: negative for money out, positive for money in. */
  amount: number;
  memo?: string;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export interface OllamaModelInfo {
  name: string;
  sizeGb: number;
  description: string;
  recommended?: boolean;
}

export const RECOMMENDED_OLLAMA_MODELS: OllamaModelInfo[] = [
  {
    name: "llama3.2:3b",
    sizeGb: 2.0,
    description: "Recommended. Fast and accurate enough for categorizing.",
    recommended: true,
  },
  {
    name: "llama3.2:1b",
    sizeGb: 1.3,
    description: "Smallest and fastest. Slightly less accurate.",
  },
  {
    name: "llama3.1:8b",
    sizeGb: 4.7,
    description: "Higher quality, slower, larger download.",
  },
  {
    name: "qwen2.5:3b",
    sizeGb: 1.9,
    description: "Alternative 3B model from Alibaba.",
  },
];

export const BANK_PROVIDERS: BankProviderInfo[] = [
  {
    id: "isracard",
    name: "Isracard",
    kind: "card",
    listsCards: true,
    color: "#E50019",
    blurb: "Israeli Mastercard / Visa",
    domain: "isracard.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        hint: "Your 9-digit Israeli national ID (Teudat Zehut). Not your card number.",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "card6Digits",
        label: "Last 6 Digits of Your Card",
        type: "text",
        placeholder: "e.g. 123456",
        hint: "The last 6 digits of your Isracard credit card number. This is NOT your ID.",
        exactLength: 6,
        numeric: true,
      },
      {
        key: "password",
        label: "Isracard Password",
        type: "password",
        placeholder: "Password you use on digital.isracard.co.il",
        hint: "The same password you use to log in on the Isracard website.",
      },
    ],
    enabled: true,
  },
  {
    id: "cal",
    name: "Visa Cal",
    kind: "card",
    color: "#1B4E97",
    blurb: "Cal-branded cards",
    domain: "cal-online.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "max",
    name: "Max",
    kind: "card",
    color: "#FF6B00",
    blurb: "Formerly Leumi Card",
    domain: "max.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "hapoalim",
    name: "Bank Hapoalim",
    kind: "bank",
    color: "#E2231A",
    blurb: "Includes Poalim wallets",
    domain: "bankhapoalim.co.il",
    credentialFields: [
      { key: "userCode", label: "User Code", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "leumi",
    name: "Bank Leumi",
    kind: "bank",
    color: "#1976A4",
    blurb: "Personal & business accounts",
    domain: "leumi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "mizrahi",
    name: "Mizrahi Tefahot",
    kind: "bank",
    color: "#0066B3",
    blurb: "Personal & mortgage banking",
    domain: "mizrahi-tefahot.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "discount",
    name: "Bank Discount",
    kind: "bank",
    color: "#2E9C5C",
    blurb: "Personal & business accounts",
    domain: "discountbank.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
      {
        key: "num",
        label: "Identifier Code",
        type: "text",
        placeholder: "Your קוד מזהה",
        hint: "The 'קוד מזהה' you set up for Discount online banking. May contain letters and numbers, not the same as your account number.",
      },
    ],
    enabled: true,
  },
  {
    id: "mercantile",
    name: "Mercantile Discount",
    kind: "bank",
    color: "#1B6A3C",
    blurb: "Discount-owned subsidiary",
    domain: "mercantile.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
      {
        key: "num",
        label: "Identifier Code",
        type: "text",
        placeholder: "Your קוד מזהה",
        hint: "The 'קוד מזהה' you set up for Mercantile online banking. May contain letters and numbers, not the same as your account number.",
      },
    ],
    enabled: true,
  },
  {
    id: "beinleumi",
    name: "First International (FIBI)",
    kind: "bank",
    color: "#C8102E",
    blurb: "Beinleumi / FIBI",
    domain: "fibi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "otsarHahayal",
    name: "Otsar Hahayal",
    kind: "bank",
    color: "#7A1F2B",
    blurb: "FIBI subsidiary (merged 2020)",
    domain: "fibi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "pagi",
    name: "Bank Pagi",
    kind: "bank",
    color: "#9F2241",
    blurb: "Hapoalim's religious-community branch",
    domain: "bankpagi.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "yahav",
    name: "Bank Yahav",
    kind: "bank",
    color: "#0F4D8C",
    blurb: "Public-sector employees · 6 months history",
    domain: "bank-yahav.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      {
        key: "nationalID",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "massad",
    name: "Bank Massad",
    kind: "bank",
    color: "#2B5F2B",
    blurb: "Teachers' bank",
    domain: "bankmassad.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "union",
    name: "Union Bank",
    kind: "bank",
    color: "#003F87",
    blurb: "Merged into Mizrahi-Tefahot (2019)",
    domain: "unionbank.co.il",
    credentialFields: [
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "amex",
    name: "American Express IL",
    kind: "card",
    color: "#006FCF",
    blurb: "Isracard-issued Amex cards",
    domain: "americanexpress.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      {
        key: "card6Digits",
        label: "Last 6 Digits of Your Card",
        type: "text",
        placeholder: "e.g. 123456",
        exactLength: 6,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "beyahadBishvilha",
    name: "Beyahad Bishvilha",
    kind: "card",
    color: "#7E3F8F",
    blurb: "Histadrut benefits / credit",
    domain: "beyahad-bishvilha.co.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "behatsdaa",
    name: "Behatsdaa",
    kind: "card",
    color: "#6E3A7A",
    blurb: "Histadrut subsidies / credit",
    domain: "behatsdaa.org.il",
    credentialFields: [
      {
        key: "id",
        label: "ID Number",
        type: "text",
        placeholder: "9-digit Israeli ID",
        maxLength: 9,
        numeric: true,
      },
      { key: "password", label: "Password", type: "password" },
    ],
    enabled: true,
  },
  {
    id: "oneZero",
    name: "One Zero",
    kind: "bank",
    color: "#000000",
    blurb: "Sync paused. Import exported files",
    domain: "onezerobank.com",
    credentialFields: [
      {
        key: "email",
        label: "Email",
        type: "email",
        placeholder: "you@example.com",
        hint: "The email you use to sign in to One Zero.",
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "Your One Zero password",
      },
      {
        key: "phoneNumber",
        label: "Phone number",
        type: "tel",
        placeholder: "050-123-4567",
        hint: "The number on your One Zero account. The SMS sign-in code is sent here.",
      },
    ],
    enabled: true,
    supportsProgrammaticTwoFactor: true,
    // One Zero's Cloudflare firewall rejects every non-app client, from any
    // network, before sign-in starts (israeli-bank-scrapers #1144).
    syncPaused: {
      issueUrl: "https://github.com/eshaham/israeli-bank-scrapers/issues/1144",
    },
  },
];

export interface ExcludedMerchant {
  id: number;
  provider: string;
  merchantKey: string;
  createdAt: string;
}
