import "server-only";

import { CompanyTypes, createScraper } from "israeli-bank-scrapers";
import type { ScrapeResult, ScrapedTransaction } from "./types";

/**
 * OneZero is the only scraper in israeli-bank-scrapers that actually implements
 * programmatic 2FA. The library exposes triggerTwoFactorAuth and
 * getLongTermTwoFactorToken on the base interface but only OneZero's concrete
 * class wires them up.
 *
 * Note: scraper.scrape() does NOT surface the persistent OTP token (it's
 * generated inside login() but dropped before returning). To capture the token
 * we run the two-step explicit flow ourselves:
 *
 *   1. triggerTwoFactorAuth(phoneNumber)   -> sends the SMS
 *   2. await user-supplied OTP via the bridge
 *   3. getLongTermTwoFactorToken(otpCode)  -> returns the long-term token
 *   4. scrape({ ..., otpLongTermToken })   -> actually fetches data
 *
 * The caller persists the token so subsequent syncs skip steps 1-3.
 */

export interface OneZeroFirstSyncOptions {
  email: string;
  password: string;
  phoneNumber: string;
  startDate: Date;
  /** Awaits the user-supplied OTP. Rejects on cancel/timeout. */
  awaitOtp: () => Promise<string>;
  /** Called when the OTP is collected so the UI can switch from "awaiting OTP" to "logging in". */
  onOtpSubmitted?: () => void;
}

export interface OneZeroSubsequentSyncOptions {
  email: string;
  password: string;
  otpLongTermToken: string;
  startDate: Date;
}

export interface OneZeroFirstSyncResult extends ScrapeResult {
  otpLongTermToken?: string;
}

export interface OneZeroTokenSyncResult extends ScrapeResult {
  /**
   * One Zero refused the saved token. It only lives for about 45 minutes
   * (israeli-bank-scrapers #1158), so the caller should ask for a new SMS code.
   */
  tokenRejected?: boolean;
}

/**
 * The library insists on "+972...". People type "050-123-4567", so accept the
 * usual Israeli spellings and convert them.
 */
export function normalizeOneZeroPhone(raw: string): string {
  const s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return `+${s.slice(2)}`;
  if (s.startsWith("972")) return `+${s}`;
  if (s.startsWith("0")) return `+972${s.slice(1)}`;
  return s;
}

const BLOCKED_MESSAGE =
  "One Zero's firewall (Cloudflare) refused the connection from this network before login started. " +
  "Your details were not checked. This is a known problem with the scraper library " +
  "(israeli-bank-scrapers issue #1144); try again later or from a different network.";

/** The library parses every reply as JSON, so a Cloudflare block page surfaces as a parse error. */
function isBlockedError(message: string): boolean {
  return /Unexpected token '<'|<!DOCTYPE|is not valid JSON/i.test(message);
}

/**
 * When /getIdToken rejects the login it returns no `resultData`, and the
 * library's destructuring throws on the missing idToken / accessToken.
 */
function isLoginRejectedError(message: string): boolean {
  return /idToken|accessToken|resultData|\b401\b|unauthori[sz]ed/i.test(message);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

const SCRAPER_TIMEOUT_MS = 60000;

function buildScraper(startDate: Date) {
  return createScraper({
    companyId: CompanyTypes.oneZero,
    startDate,
    combineInstallments: false,
    showBrowser: false,
    timeout: SCRAPER_TIMEOUT_MS,
  });
}

function mapAccounts(
  scrapeResult: Awaited<ReturnType<ReturnType<typeof buildScraper>["scrape"]>>
): ScrapeResult["accounts"] {
  return (scrapeResult.accounts ?? []).map((account) => ({
    accountNumber: account.accountNumber,
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
}

export async function scrapeOneZeroFirstTime(
  opts: OneZeroFirstSyncOptions
): Promise<OneZeroFirstSyncResult> {
  try {
    return await firstTime(opts);
  } catch (err) {
    const message = messageOf(err);
    return {
      success: false,
      accounts: [],
      errorMessage: isBlockedError(message)
        ? BLOCKED_MESSAGE
        : `One Zero sync failed: ${message}`,
    };
  }
}

async function firstTime(
  opts: OneZeroFirstSyncOptions
): Promise<OneZeroFirstSyncResult> {
  const scraper = buildScraper(opts.startDate);

  const phoneNumber = normalizeOneZeroPhone(opts.phoneNumber);
  if (!/^\+\d{9,15}$/.test(phoneNumber)) {
    return {
      success: false,
      accounts: [],
      errorMessage:
        "The phone number for One Zero doesn't look right. Use the number on your One Zero account, like 050-123-4567 or +972501234567.",
    };
  }

  const trigger = await scraper.triggerTwoFactorAuth(phoneNumber);
  if (!trigger.success) {
    return {
      success: false,
      accounts: [],
      errorMessage:
        trigger.errorMessage ?? "Failed to send 2FA code to your phone.",
    };
  }

  let otpCode: string;
  try {
    otpCode = await opts.awaitOtp();
  } catch (err) {
    return {
      success: false,
      accounts: [],
      errorMessage:
        err instanceof Error ? err.message : "OTP entry was cancelled.",
    };
  }
  opts.onOtpSubmitted?.();

  const tokenResult = await scraper.getLongTermTwoFactorToken(otpCode);
  if (!tokenResult.success) {
    return {
      success: false,
      accounts: [],
      errorMessage:
        tokenResult.errorMessage ??
        "The one-time code was rejected by One Zero.",
    };
  }

  const longTermToken = tokenResult.longTermTwoFactorAuthToken;

  const scrapeResult = await scraper.scrape({
    email: opts.email,
    password: opts.password,
    otpLongTermToken: longTermToken,
  });

  if (!scrapeResult.success) {
    const message = scrapeResult.errorMessage ?? "";
    // A token minted seconds ago can't be stale, so a rejected login here
    // means the email or password is wrong. Don't keep that token around.
    if (isLoginRejectedError(message)) {
      return {
        success: false,
        accounts: [],
        errorMessage:
          "One Zero accepted the SMS code but not the email and password. Check them in Settings and sync again.",
      };
    }
    return {
      success: false,
      accounts: [],
      errorMessage: isBlockedError(message)
        ? BLOCKED_MESSAGE
        : message || "Scrape failed after login.",
      otpLongTermToken: longTermToken,
    };
  }

  return {
    success: true,
    accounts: mapAccounts(scrapeResult),
    otpLongTermToken: longTermToken,
  };
}

export async function scrapeOneZeroWithToken(
  opts: OneZeroSubsequentSyncOptions
): Promise<OneZeroTokenSyncResult> {
  const scraper = buildScraper(opts.startDate);
  let scrapeResult: Awaited<ReturnType<typeof scraper.scrape>>;
  try {
    scrapeResult = await scraper.scrape({
      email: opts.email,
      password: opts.password,
      otpLongTermToken: opts.otpLongTermToken,
    });
  } catch (err) {
    scrapeResult = { success: false, errorMessage: messageOf(err) };
  }

  if (!scrapeResult.success) {
    const message = scrapeResult.errorMessage ?? "";
    if (isBlockedError(message)) {
      return { success: false, accounts: [], errorMessage: BLOCKED_MESSAGE };
    }
    if (isLoginRejectedError(message)) {
      return {
        success: false,
        accounts: [],
        tokenRejected: true,
        errorMessage:
          "One Zero needs a new SMS code. Sync again and enter the code sent to your phone.",
      };
    }
    return {
      success: false,
      accounts: [],
      errorMessage: message || "Scrape failed.",
    };
  }

  return {
    success: true,
    accounts: mapAccounts(scrapeResult),
  };
}
