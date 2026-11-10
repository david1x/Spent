import "server-only";

import { CompanyTypes, createScraper } from "israeli-bank-scrapers";
import type { CardScope, ScrapeResult, ScrapedTransaction } from "./types";
import type { BankProvider } from "@/lib/types";
import { getWorkspaceSetting } from "../db/queries/settings";
import { formatSyncError } from "@/lib/sync-error";
import { SpentIsracardScraper } from "./isracard";

export const PROVIDER_MAP: Record<string, CompanyTypes> = {
  isracard: CompanyTypes.isracard,
  cal: CompanyTypes.visaCal,
  max: CompanyTypes.max,
  amex: CompanyTypes.amex,
  hapoalim: CompanyTypes.hapoalim,
  leumi: CompanyTypes.leumi,
  mizrahi: CompanyTypes.mizrahi,
  discount: CompanyTypes.discount,
  mercantile: CompanyTypes.mercantile,
  beinleumi: CompanyTypes.beinleumi,
  otsarHahayal: CompanyTypes.otsarHahayal,
  union: CompanyTypes.union,
  pagi: CompanyTypes.pagi,
  yahav: CompanyTypes.yahav,
  massad: CompanyTypes.massad,
  beyahadBishvilha: CompanyTypes.beyahadBishvilha,
  behatsdaa: CompanyTypes.behatsdaa,
  oneZero: CompanyTypes.oneZero,
};

function sanitizeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An unknown error occurred during scraping";
  }
  let msg = error.message;
  // Strip 5+ digit numbers (likely ID numbers, card digits, etc.)
  msg = msg.replace(/\b\d{5,}\b/g, "[REDACTED]");
  // Strip password and id values from JSON-like blobs.
  // Match a key followed by quoted string OR unquoted value, non-greedy.
  msg = msg.replace(
    /"(password|id|card6Digits|cardSuffix)"\s*:\s*"[^"]*"/gi,
    '"$1":"[REDACTED]"'
  );
  msg = msg.replace(
    /\b(password|id|card6Digits|cardSuffix)\s*=\s*\S+/gi,
    "$1=[REDACTED]"
  );
  return msg;
}

/**
 * Detect transient errors we should retry, or surface with friendlier copy.
 */
function classifyError(error: unknown): {
  retryable: boolean;
  friendly: string | null;
} {
  if (!(error instanceof Error)) {
    return { retryable: false, friendly: null };
  }
  const msg = error.message;

  // Bot-protection block from the bank. The Isracard variant returns
  // "result: Block Automation" out of the ValidateIdData endpoint, so this
  // must match BEFORE the ValidateIdData credential check below.
  if (/Block Automation|Cloudflare|captcha|recaptcha/i.test(msg)) {
    return {
      retryable: false,
      friendly:
        "The bank's bot protection blocked this sync. It usually clears after a few hours (often overnight). Wait and try again. You can also enable 'Show browser during sync' in settings - headful browsers are harder to detect.",
    };
  }

  // Isracard ValidateIdData returns an empty body when the ID/card-suffix
  // combination doesn't match a real card. This is almost always a credential
  // typo (most commonly entering the full ID into the "Last 6 Digits" field).
  if (/reqName=ValidateIdData/.test(msg)) {
    return {
      retryable: false,
      friendly:
        "Isracard rejected your ID and card combination. Double-check the 'Last 6 Digits of Your Card' field - it should be the last 6 digits of your credit card number, NOT your Israeli ID. Re-run setup from the settings drawer to fix it.",
    };
  }

  // Empty JSON response from bank - usually transient (rate limit, bot block, flaky endpoint).
  if (
    /Unexpected end of JSON input/.test(msg) ||
    /fetchPostWithinPage parse error/.test(msg)
  ) {
    return {
      retryable: true,
      friendly:
        "The bank returned an empty response. This usually means temporary rate limiting or a flaky endpoint on their side. We'll retry automatically; if it keeps failing, wait a few minutes and try again.",
    };
  }

  if (/net::ERR_/i.test(msg) || /ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    return {
      retryable: true,
      friendly:
        "Network error reaching the bank. Check your connection and try again.",
    };
  }

  if (/Navigation timeout|TimeoutError/i.test(msg)) {
    return {
      retryable: true,
      friendly:
        "The bank's site took too long to respond. Often temporary - try again in a minute.",
    };
  }

  // The bank's page navigated while the scraper was working in it (a
  // redirect or self-reload mid-login). The next attempt usually goes through.
  if (/Execution context was destroyed|detached Frame/i.test(msg)) {
    return {
      retryable: true,
      friendly:
        "The bank's site reloaded in the middle of the sync. This is usually temporary. Try again in a few minutes.",
    };
  }

  // Puppeteer reports a closed tab or window this way. With "Show browser
  // during sync" on, that's almost always the user closing it early.
  if (/Target closed|Session closed|browser has disconnected|Connection closed/i.test(msg)) {
    return {
      retryable: false,
      friendly:
        "The browser window closed before the sync finished. Leave it open until Spent closes it. Some banks (Isracard, Amex) sign in in the background, so the login form in that window stays empty even when it's working.",
    };
  }

  return { retryable: false, friendly: null };
}

const FRIENDLY_ERRORS: Record<string, string> = {
  INVALID_PASSWORD:
    "The credentials were rejected by the bank. Double-check ID, card last 6 digits, and password.",
  CHANGE_PASSWORD:
    "The bank is asking you to change your password. Log in via the bank's website first.",
  ACCOUNT_BLOCKED:
    "The account is blocked by the bank. Resolve this on the bank's website.",
  TIMEOUT:
    "The scrape timed out. The bank's site may be slow or down. Try again.",
  TWO_FACTOR_RETRIEVER_MISSING:
    "This account is asking for 2FA. For most banks, turn on 'This account requires 2FA' in the bank's settings so Spent shows the browser and you can solve it manually. For One Zero, make sure the phone number is set on the account.",
  GENERIC:
    "The scraper failed unexpectedly. Run with 'Show browser during sync' enabled to see what's happening.",
  GENERAL_ERROR:
    "The scraper failed unexpectedly. Run with 'Show browser during sync' enabled to see what's happening.",
};

async function runScrape(
  provider: BankProvider,
  credentials: Record<string, string>,
  startDate: Date,
  showBrowser: boolean,
  cardScope?: CardScope
): Promise<ScrapeResult> {
  const companyId = PROVIDER_MAP[provider];
  if (!companyId) {
    return {
      success: false,
      accounts: [],
      errorMessage: `Unsupported provider: ${provider}`,
    };
  }

  const chromiumArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
  ];
  // Chromium's renderer sandbox is on by default on macOS, Windows, and
  // most Linux installs. Self-hosters running as root or in unprivileged
  // Docker need to opt out (the sandbox fails to start there).
  if (process.env.SPENT_DISABLE_CHROMIUM_SANDBOX === "1") {
    chromiumArgs.push("--no-sandbox");
  }

  const options = {
    companyId,
    startDate,
    combineInstallments: false,
    showBrowser,
    // Verbose logs include URLs and posted payloads (incl. credentials).
    // Only enable when the user is also showing the browser (= they're debugging).
    verbose: showBrowser,
    timeout: 60000,
    args: chromiumArgs,
  };
  // Isracard needs a click on its login page first; see ./isracard.ts.
  let scraper: ReturnType<typeof createScraper>;
  if (provider === "isracard") {
    const isracard = new SpentIsracardScraper(options);
    if (cardScope) isracard.cardScope = cardScope;
    scraper = isracard;
  } else {
    scraper = createScraper(options);
  }

  // credentials shape varies by provider; the library accepts different types per bank
  const result = await scraper.scrape(
    credentials as Parameters<typeof scraper.scrape>[0]
  );

  if (!result.success) {
    const errorType = result.errorType ?? "GENERIC";
    console.error(`[scraper] failed (${errorType}):`, result.errorMessage);
    // The library returns failures instead of throwing them. Throw the
    // transient ones so scrapeBank's retry loop gets to try again.
    if (result.errorMessage && classifyError(new Error(result.errorMessage)).retryable) {
      throw new Error(result.errorMessage);
    }
    const detail = result.errorMessage
      ? sanitizeError(new Error(result.errorMessage))
      : errorType;
    // The library reports bot blocks and empty responses as GENERIC, so the
    // message pattern is more specific than the error type. Check it first.
    const classified = result.errorMessage
      ? classifyError(new Error(result.errorMessage)).friendly
      : null;
    const friendly =
      classified ?? FRIENDLY_ERRORS[errorType] ?? "Scraping failed.";
    return {
      success: false,
      accounts: [],
      errorMessage: formatSyncError(friendly, detail),
    };
  }

  const txnCount = (result.accounts ?? []).reduce(
    (sum, a) => sum + a.txns.length,
    0
  );
  console.log(
    `[scraper] success: ${result.accounts?.length ?? 0} account(s), ${txnCount} transaction(s)`
  );

  const accounts = (result.accounts ?? []).map((account) => ({
    accountNumber: account.accountNumber,
    // Set by scrapers that list their cards (./isracard-digital-v3.ts).
    card: (account as { card?: { label: string | null; active: boolean } }).card,
    balance: typeof account.balance === "number" && Number.isFinite(account.balance) ? account.balance : undefined,
    currency: (account as { currency?: string }).currency,
    savings: (account as { savingsAccount?: boolean }).savingsAccount === true,
    transactions: account.txns.map(
      (txn): ScrapedTransaction => ({
        type: txn.type === "installments" ? "installments" : "normal",
        identifier: txn.identifier ?? undefined,
        date: txn.date,
        processedDate: txn.processedDate,
        originalAmount: txn.originalAmount,
        originalCurrency: txn.originalCurrency,
        chargedAmount: txn.chargedAmount,
        chargedCurrency: txn.chargedCurrency ?? undefined,
        description: txn.description,
        memo: txn.memo ?? undefined,
        installments: txn.installments
          ? { number: txn.installments.number, total: txn.installments.total }
          : undefined,
        status: txn.status === "completed" ? "completed" : "pending",
      })
    ),
  }));

  return { success: true, accounts };
}

interface ScrapeBankOptions {
  /**
   * When true, force showBrowser regardless of the workspace setting. Used for
   * the per-bank manual-2FA flag so the user can solve a 2FA challenge in the
   * popup for just that one provider.
   */
  manualTwoFactor?: boolean;
  /** Which cards to read, for card companies that list them (Isracard). */
  cardScope?: CardScope;
}

export async function scrapeBank(
  workspaceId: number,
  provider: BankProvider,
  credentials: Record<string, string>,
  startDate: Date,
  options: ScrapeBankOptions = {}
): Promise<ScrapeResult> {
  const workspaceShowBrowser =
    getWorkspaceSetting(workspaceId, "scraper_show_browser") === "true";
  const showBrowser = options.manualTwoFactor === true || workspaceShowBrowser;
  const MAX_ATTEMPTS = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[scraper] starting scrape for ${provider} from ${startDate.toISOString()} (attempt ${attempt}/${MAX_ATTEMPTS}, showBrowser=${showBrowser})`
      );
      return await runScrape(provider, credentials, startDate, showBrowser, options.cardScope);
    } catch (error) {
      lastError = error;
      console.error(
        `[scraper] unexpected error on attempt ${attempt}:`,
        sanitizeError(error)
      );
      const { retryable } = classifyError(error);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const backoffMs = 2000 * attempt;
      console.log(`[scraper] retryable error, waiting ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  const { friendly } = classifyError(lastError);
  const detail = sanitizeError(lastError);
  return {
    success: false,
    accounts: [],
    errorMessage: friendly ? formatSyncError(friendly, detail) : detail,
  };
}
