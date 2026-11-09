import "server-only";

import type { Page } from "puppeteer";
import { fetchPostWithinPage } from "israeli-bank-scrapers/lib/helpers/fetch";
import type { CardScope } from "./types";
import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
} from "israeli-bank-scrapers/lib/transactions";

/**
 * Isracard moved its personal area to web.isracard.co.il, and accounts that
 * were migrated no longer answer the old digital.isracard.co.il data
 * endpoints the library calls. This reads the new "DigitalV3" JSON API the
 * site itself uses, from inside the logged-in page.
 *
 * Ported from the data half of the open upstream PR
 * eshaham/israeli-bank-scrapers#1159 (request shapes, response shapes and
 * conversion rules). Drop this file once a released library version ships it.
 */

const API = "/ocp/transactions/DigitalV3.Transactions";
const GET_CARD_LIST_COMPANY_CODE = "99";
const CARD_SUFFIX_LENGTH = 4;
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
/** Upstream's pacing between requests; faster runs trip Isracard's rate limiting. */
const SLEEP_BETWEEN_MS = 2_500;

interface Card {
  cardName?: string;
  companyCode: string;
  cardStatus: string;
  cardSuffix: string;
  serviceType: string;
  isActive: boolean;
  isBlock: boolean;
  isPartner: boolean;
  limitData?: { creditLimitAmount: string; limitUsed: string };
  cardChargeNext?: { billingDate: string };
}

interface ApiResponse<T> {
  data: T | null;
  errorCode: string;
  errorDescription: string | null;
  isSuccess: boolean;
}

interface ApprovedTransaction {
  purchaseDate: string;
  israelTransactionTime: string;
  businessName: string;
  originalAmount: number;
  currencyIso: string;
  ilsBillingAmount: number;
  extraDetails: string | null;
  seqConfirmationNumber: string;
  branchCodeDescription: string | null;
}

interface Voucher {
  purchaseDate: string;
  purchaseTime: string | null;
  businessName: string;
  originalAmount: number;
  originalCurrencyIso: string;
  billingAmount: number;
  moreInfo: string | null;
  seqVoucherNumber: string;
  currentInstallmentNum: number | null;
  numberOfInstallment: number | null;
  transactionDescription: string | null;
}

interface OutOfStatementGroup {
  immediateVouchersCurrencyDate: Voucher[] | null;
  totalVouchersCurrencyDate: { dateImmediateVouchers?: string } | null;
}

interface TransactionsData {
  approvals: { approvedTransactions: ApprovedTransaction[] | null } | null;
  israelAbroadVouchers: {
    vouchers: { israelAbroadVouchersList: Voucher[] | null } | null;
    outOfStatementChargeDateVouchers: OutOfStatementGroup[] | null;
  } | null;
}

/** Same fields the library's own Isracard accounts carry, plus what the card is. */
export interface IsracardAccount {
  card?: { label: string | null; active: boolean };
  accountNumber: string;
  txns: Transaction[];
  balance: number | undefined;
  balanceDate: string | undefined;
  cardFrame: number | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(SLEEP_BETWEEN_MS + Math.random() * 500);

/** "DD/MM/YYYY" plus optional "HH:mm[:ss]", read as Israel local time like the rest of the scraper. */
function parseIsraeliDate(date: string, time?: string | null): Date {
  const [d, m, y] = date.split("/").map(Number);
  const [hh = 0, mm = 0, ss = 0] = (time ?? "").split(":").map((n) => Number(n) || 0);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** First day of every month from `start` through `futureMonths` past this month. */
function monthsToScrape(start: Date, futureMonths: number): Date[] {
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + futureMonths, 1);
  while (cursor <= last) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function sameCharge(approved: ApprovedTransaction, voucher: Voucher): boolean {
  return (
    voucher.purchaseDate === approved.purchaseDate &&
    voucher.originalAmount === approved.originalAmount &&
    voucher.originalCurrencyIso === approved.currencyIso &&
    (voucher.businessName || "").trim() === (approved.businessName || "").trim()
  );
}

function fromApproved(txn: ApprovedTransaction): Transaction {
  const iso = parseIsraeliDate(txn.purchaseDate, txn.israelTransactionTime).toISOString();
  return {
    type: TransactionTypes.Normal,
    identifier: txn.seqConfirmationNumber,
    date: iso,
    processedDate: iso,
    originalAmount: -txn.originalAmount,
    originalCurrency: txn.currencyIso,
    chargedAmount: -txn.ilsBillingAmount,
    chargedCurrency: "ILS",
    description: (txn.businessName || "").trim(),
    memo: txn.extraDetails || "",
    category: txn.branchCodeDescription?.trim() || undefined,
    status: TransactionStatuses.Pending,
  };
}

function fromVoucher(voucher: Voucher, processedDateIso: string): Transaction {
  const installments =
    voucher.numberOfInstallment && voucher.currentInstallmentNum
      ? { number: voucher.currentInstallmentNum, total: voucher.numberOfInstallment }
      : undefined;
  return {
    type: installments ? TransactionTypes.Installments : TransactionTypes.Normal,
    identifier: voucher.seqVoucherNumber,
    date: parseIsraeliDate(voucher.purchaseDate, voucher.purchaseTime).toISOString(),
    processedDate: processedDateIso,
    originalAmount: -voucher.originalAmount,
    originalCurrency: voucher.originalCurrencyIso,
    chargedAmount: -voucher.billingAmount,
    chargedCurrency: "ILS",
    description: (voucher.businessName || "").trim(),
    memo: (voucher.moreInfo || "").trim(),
    category: voucher.transactionDescription?.trim() || undefined,
    installments,
    status: TransactionStatuses.Completed,
  };
}

/**
 * An installment payment carries the original purchase date. Shift it by the
 * payment number so each payment lands in its own month, as the library's
 * fixInstallments does when combineInstallments is off.
 */
function spreadInstallment(txn: Transaction): Transaction {
  if (txn.type !== TransactionTypes.Installments || !txn.installments) return txn;
  const date = new Date(txn.date);
  date.setMonth(date.getMonth() + txn.installments.number - 1);
  return { ...txn, date: date.toISOString() };
}

/**
 * Worth asking again: the page navigated or reloaded while a request ran
 * inside it, or the site answered with an HTML page instead of JSON (it does
 * while the personal area is still settling, and when it throttles).
 */
const TRANSIENT =
  /detached Frame|Execution context was destroyed|Failed to fetch|Target closed|Unexpected token '<'|is not valid JSON/i;
const RETRIES = 3;
/** Back-off before each retry, longer every time. */
const RETRY_WAIT_MS = [4_000, 10_000];

async function post<T>(page: Page, url: string, body: Record<string, unknown>, what: string): Promise<T> {
  let response: ApiResponse<T> | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetchPostWithinPage<ApiResponse<T>>(page, url, body, JSON_HEADERS);
      break;
    } catch (err) {
      // The personal area reloads itself shortly after it opens (and now and
      // then later), which kills a request made from inside it. Let the page
      // settle back on the site and ask again.
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= RETRIES || !TRANSIENT.test(message)) {
        if (/Unexpected token|not valid JSON/i.test(message)) {
          console.warn(`[scraper] isracard: ${what} keeps answering ${await describeReply(page, url, body)}`);
        }
        throw err;
      }
      console.warn(
        `[scraper] isracard: ${what} hit a reload or an HTML reply, retrying (${attempt}/${RETRIES - 1})`
      );
      await sleep(RETRY_WAIT_MS[attempt - 1] ?? 10_000);
      await page.waitForNetworkIdle({ idleTime: 1_000, timeout: 15_000 }).catch(() => undefined);
      const origin = new URL(url).origin;
      if (new URL(page.url()).origin !== origin) {
        await page
          .goto(`${origin}/transactions`, { waitUntil: "networkidle2", timeout: 30_000 })
          .catch(() => undefined);
      }
    }
  }
  if (!response || !response.isSuccess || !response.data) {
    throw new Error(`Isracard: couldn't ${what}: ${response?.errorDescription ?? "no data returned"}`);
  }
  return response.data;
}

/**
 * What an HTML answer actually was (status and page title), for the log.
 * Asks once more; only called after the last retry failed.
 */
async function describeReply(page: Page, url: string, body: Record<string, unknown>): Promise<string> {
  return page
    .evaluate(
      async (u: string, b: Record<string, unknown>, h: Record<string, string>) => {
        const res = await fetch(u, {
          method: "POST",
          body: JSON.stringify(b),
          credentials: "include",
          headers: h,
        });
        const text = await res.text();
        const title = /<title[^>]*>([^<]*)</i.exec(text)?.[1]?.trim();
        const gist = text
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        return `HTTP ${res.status}: ${title || gist}`;
      },
      url,
      body,
      JSON_HEADERS
    )
    .catch((e: unknown) => `unknown (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
}

/** The card's product name as the site shows it ("ויזה זהב"). */
function cardLabel(card: Card): string | null {
  return card.cardName?.trim() || null;
}

export async function fetchDigitalV3Accounts(
  page: Page,
  options: {
    webBaseUrl: string;
    companyCode: string;
    startDate: Date;
    futureMonths?: number;
    scope?: CardScope;
  }
): Promise<IsracardAccount[]> {
  const scope = options.scope ?? {};
  const base = `${options.webBaseUrl}${API}`;

  const cardList = await post<{ cardsList: Card[] }>(
    page,
    `${base}/GetCardList`,
    { companyCode: GET_CARD_LIST_COMPANY_CODE, cardSuffixLength: CARD_SUFFIX_LENGTH },
    "read the card list"
  );
  // Every card on this login is read. The list can label some cards with
  // another group company (Visa cards show as 44 next to Mastercards at 11),
  // but the site still asks for all of them under the login's own code, so
  // requests below always send that.
  // Inactive and blocked cards stay in too: a disabled card can still carry
  // standing charges (subscriptions, insurance) that bill every month.
  for (const c of cardList.cardsList) {
    console.log(
      `[scraper] isracard: card ••${c.cardSuffix} company=${c.companyCode} status=${c.cardStatus} service=${c.serviceType} active=${c.isActive} blocked=${c.isBlock} partner=${c.isPartner}`
    );
  }
  const describe = (c: Card) => ({ label: cardLabel(c), active: c.isActive && !c.isBlock });
  if (scope.listOnly) {
    return cardList.cardsList.map((c) => ({
      accountNumber: c.cardSuffix,
      txns: [],
      balance: undefined,
      balanceDate: undefined,
      cardFrame: undefined,
      card: describe(c),
    }));
  }
  const cards = cardList.cardsList.filter(
    (c) => (!scope.only || scope.only.includes(c.cardSuffix)) && !scope.skip?.includes(c.cardSuffix)
  );
  console.log(
    `[scraper] isracard: reading ${cards.length} card(s), ${cards.filter((c) => c.isActive && !c.isBlock).length} active`
  );

  // Upstream caps history at a year; older months come back empty or fail.
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const start = options.startDate > oneYearAgo ? options.startDate : oneYearAgo;
  const months = monthsToScrape(start, options.futureMonths ?? 1);
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const byCard = new Map<string, Transaction[]>(cards.map((c) => [c.cardSuffix, []]));
  /** Active cards the site wouldn't serve this run, and why. Skipped from then on. */
  const unreadable = new Map<string, unknown>();
  /**
   * Card status to send per card. The site sends 0 for active cards and 1 for
   * a cancelled one, whatever the list says (a cancelled card is listed as
   * 14). If that's refused, 0 is tried once and kept when it works.
   */
  const statusFor = new Map<string, number>(
    cards.map((c) => [c.cardSuffix, c.isActive ? Number(c.cardStatus) : 1])
  );
  const companyCode = Number(options.companyCode);
  /** Cards whose billing-date request failed once; not asked again this run. */
  const noBillingDate = new Set<string>();

  for (const month of months) {
    const isNextBillingDate = month > currentMonthStart;
    for (const card of cards) {
      if (unreadable.has(card.cardSuffix)) continue;
      const live = card.isActive && !card.isBlock;
      let billing: { cards: Record<string, { billingDate: string }> } = { cards: {} };
      let data: TransactionsData;
      try {
        // The billing date only dates the month's statement. The site itself
        // never asks for it before listing transactions, and it errors for some
        // cards (company 44), so a failure here falls back to the month.
        if (!noBillingDate.has(card.cardSuffix)) {
          await pace();
          billing = await post<{
            cards: Record<string, { billingDate: string }>;
          }>(
            page,
            `${base}/GetMonthlyBilling`,
            {
              cards: [
                {
                  cardStatus: statusFor.get(card.cardSuffix),
                  cardSuffix: card.cardSuffix,
                  companyCode,
                  serviceType: Number(card.serviceType),
                  isPartner: card.isPartner,
                },
              ],
              billingDate: `${pad(month.getMonth() + 1)}/${month.getFullYear()}`,
            },
            `read the billing date for card ${card.cardSuffix}`
          ).catch((err: unknown) => {
            noBillingDate.add(card.cardSuffix);
            console.warn(
              `[scraper] isracard: no billing date for card ••${card.cardSuffix} ${pad(month.getMonth() + 1)}/${month.getFullYear()}, using the month: ${err instanceof Error ? err.message.slice(0, 100) : "error"}`
            );
            return { cards: {} };
          });
        }

        const readTransactions = async (cardStatus: number | undefined) => {
          await pace();
          return post<TransactionsData>(
            page,
            `${base}/GetTransactionsList`,
            {
              card4Number: card.cardSuffix,
              isNextBillingDate,
              cardStatus,
              billingMonth: `01/${pad(month.getMonth() + 1)}/${month.getFullYear()}`,
              companyCode,
              isPartner: card.isPartner,
            },
            `read transactions for card ${card.cardSuffix}`
          );
        };
        const status = statusFor.get(card.cardSuffix);
        try {
          data = await readTransactions(status);
        } catch (err) {
          if (status === 0) throw err;
          data = await readTransactions(0);
          statusFor.set(card.cardSuffix, 0);
          console.log(
            `[scraper] isracard: card ••${card.cardSuffix} reads with status 0 instead of ${status}`
          );
        }
      } catch (err) {
        // One card the site won't serve shouldn't cost the others their sync.
        // An active card is dropped for the rest of this run; a disabled card
        // can simply lack some months, so only that month is skipped.
        if (live) {
          unreadable.set(card.cardSuffix, err);
          console.warn(
            `[scraper] isracard: couldn't read card ••${card.cardSuffix} (company ${card.companyCode}), skipping it this sync: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`
          );
          continue;
        }
        console.warn(
          `[scraper] isracard: skipped ${pad(month.getMonth() + 1)}/${month.getFullYear()} of inactive card ••${card.cardSuffix}: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`
        );
        continue;
      }
      const billingDate = billing.cards[card.cardSuffix]?.billingDate;
      const processedDateIso = billingDate
        ? parseIsraeliDate(billingDate).toISOString()
        : month.toISOString();

      const vouchers = data.israelAbroadVouchers?.vouchers?.israelAbroadVouchersList ?? [];
      const outOfStatement = data.israelAbroadVouchers?.outOfStatementChargeDateVouchers ?? [];
      const allVouchers = [
        ...vouchers,
        ...outOfStatement.flatMap((g) => g.immediateVouchersCurrencyDate ?? []),
      ];
      // A charge can appear both as a pending approval and as a settled
      // voucher in the same response. Keep the settled one.
      const pending = (data.approvals?.approvedTransactions ?? []).filter(
        (a) => !allVouchers.some((v) => sameCharge(a, v))
      );

      const list = byCard.get(card.cardSuffix)!;
      list.push(...pending.map(fromApproved));
      list.push(...vouchers.map((v) => fromVoucher(v, processedDateIso)));
      for (const group of outOfStatement) {
        const groupDate = group.totalVouchersCurrencyDate?.dateImmediateVouchers;
        const groupIso = groupDate ? parseIsraeliDate(groupDate).toISOString() : processedDateIso;
        list.push(...(group.immediateVouchersCurrencyDate ?? []).map((v) => fromVoucher(v, groupIso)));
      }
    }
  }

  const live = cards.filter((c) => c.isActive && !c.isBlock);
  if (live.length > 0 && live.every((c) => unreadable.has(c.cardSuffix))) {
    throw unreadable.get(live[0].cardSuffix);
  }

  const startTime = start.getTime();
  return cards.map((card) => {
    const txns = (byCard.get(card.cardSuffix) ?? [])
      .map(spreadInstallment)
      .filter((t) => new Date(t.date).getTime() >= startTime);
    const limitUsed = Number(card.limitData?.limitUsed);
    const frame = Number(card.limitData?.creditLimitAmount);
    const nextCharge = card.cardChargeNext?.billingDate;
    return {
      accountNumber: card.cardSuffix,
      card: describe(card),
      txns,
      balance: card.limitData && !Number.isNaN(limitUsed) ? -limitUsed : undefined,
      balanceDate: nextCharge ? parseIsraeliDate(nextCharge).toISOString() : undefined,
      cardFrame: card.limitData && !Number.isNaN(frame) ? frame : undefined,
    };
  });
}
