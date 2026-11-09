import "server-only";

export interface ScrapedTransaction {
  type: "normal" | "installments";
  identifier?: string | number;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  installments?: { number: number; total: number };
  status: "completed" | "pending";
}

export interface ScrapedAccount {
  accountNumber: string;
  transactions: ScrapedTransaction[];
  /** Card companies that list their cards say what each one is. */
  card?: { label: string | null; active: boolean };
}

/** Which cards of a card login a scrape reads (for card companies that list cards). */
export interface CardScope {
  /** Sign in and read the card list only, no transactions: the quick card check. */
  listOnly?: boolean;
  /** Read only these cards (last digits, as the card company reports them). */
  only?: string[];
  /** Leave these cards out. */
  skip?: string[];
}

export interface ScrapeResult {
  success: boolean;
  accounts: ScrapedAccount[];
  errorMessage?: string;
}
