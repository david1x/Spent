/**
 * GET /api/cash: what's in the bank now and what's still due before the
 * period ends. Every number is computed in src/server/insights/cash.ts.
 */

export interface CashAccount {
  credentialId: number;
  provider: string;
  label: string | null;
  accountNumber: string;
  /** In the account's own currency. */
  balance: number;
  currency: string;
  /** In shekels; foreign currency at today's rate. */
  balanceIls: number;
  /** A deposit or savings plan: shown, not counted as money to spend. */
  savings: boolean;
  /** When the bank last reported it (UTC, SQLite format). */
  updatedAt: string;
}

export type CashEventKind = "card_bill" | "bill" | "income";

export interface CashEvent {
  date: string;
  kind: CashEventKind;
  label: string;
  /** Signed: negative leaves the bank. */
  amount: number;
  /** A usage-based bill, or a card statement still collecting purchases. */
  estimated: boolean;
  /** Expected in the last few days and not seen yet (a salary that's a day late). */
  late?: boolean;
  /** Card statements: which card, how many purchases, and whether it still takes new ones. */
  card?: { credentialId: number; accountNumber: string; count: number; open: boolean };
}

export interface CashStatus {
  /** The workspace has a bank login (not just cards). */
  hasBank: boolean;
  accounts: CashAccount[];
  /** Every account but savings, in shekels. */
  available: number;
  savings: number;
  /** The oldest balance among the accounts (UTC, SQLite format). */
  asOf: string | null;
  today: string;
  periodEnd: string;
  /** Tomorrow through the period's last day, oldest first, after anything late. */
  events: CashEvent[];
  /** `available` after every event. */
  projected: number;
  /**
   * Early next period, through the last card statement whose purchases are
   * already made: those statements and the recurring items due by then.
   */
  later: CashEvent[];
  /** `projected` after those too. */
  projectedAfterLater: number;
}
