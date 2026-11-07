import "server-only";

import type { Page } from "puppeteer";
import { fetchPostWithinPage } from "israeli-bank-scrapers/lib/helpers/fetch";
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

/** Same fields the library's own Isracard accounts carry. */
export interface IsracardAccount {
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

async function post<T>(page: Page, url: string, body: Record<string, unknown>, what: string): Promise<T> {
  const response = await fetchPostWithinPage<ApiResponse<T>>(page, url, body, JSON_HEADERS);
  if (!response || !response.isSuccess || !response.data) {
    throw new Error(`Isracard: couldn't ${what}: ${response?.errorDescription ?? "no data returned"}`);
  }
  return response.data;
}

export async function fetchDigitalV3Accounts(
  page: Page,
  options: { webBaseUrl: string; companyCode: string; startDate: Date; futureMonths?: number }
): Promise<IsracardAccount[]> {
  const base = `${options.webBaseUrl}${API}`;
  const companyCodeNum = Number(options.companyCode);

  const cardList = await post<{ cardsList: Card[] }>(
    page,
    `${base}/GetCardList`,
    { companyCode: GET_CARD_LIST_COMPANY_CODE, cardSuffixLength: CARD_SUFFIX_LENGTH },
    "read the card list"
  );
  // The list covers every Isracard Group card on the account (Amex too).
  const cards = cardList.cardsList.filter(
    (c) => c.companyCode === options.companyCode && c.isActive && !c.isBlock
  );
  console.log(`[scraper] isracard: ${cards.length} active card(s) on the new site`);

  // Upstream caps history at a year; older months come back empty or fail.
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const start = options.startDate > oneYearAgo ? options.startDate : oneYearAgo;
  const months = monthsToScrape(start, options.futureMonths ?? 1);
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const byCard = new Map<string, Transaction[]>(cards.map((c) => [c.cardSuffix, []]));

  for (const month of months) {
    const isNextBillingDate = month > currentMonthStart;
    for (const card of cards) {
      await pace();
      const billing = await post<{ cards: Record<string, { billingDate: string }> }>(
        page,
        `${base}/GetMonthlyBilling`,
        {
          cards: [
            {
              cardStatus: Number(card.cardStatus),
              cardSuffix: card.cardSuffix,
              companyCode: companyCodeNum,
              serviceType: Number(card.serviceType),
              isPartner: card.isPartner,
            },
          ],
          billingDate: `${pad(month.getMonth() + 1)}/${month.getFullYear()}`,
        },
        `read the billing date for card ${card.cardSuffix}`
      );
      const billingDate = billing.cards[card.cardSuffix]?.billingDate;
      const processedDateIso = billingDate
        ? parseIsraeliDate(billingDate).toISOString()
        : month.toISOString();

      await pace();
      const data = await post<TransactionsData>(
        page,
        `${base}/GetTransactionsList`,
        {
          card4Number: card.cardSuffix,
          isNextBillingDate,
          cardStatus: Number(card.cardStatus),
          billingMonth: `01/${pad(month.getMonth() + 1)}/${month.getFullYear()}`,
          companyCode: companyCodeNum,
          isPartner: card.isPartner,
        },
        `read transactions for card ${card.cardSuffix}`
      );

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
      txns,
      balance: card.limitData && !Number.isNaN(limitUsed) ? -limitUsed : undefined,
      balanceDate: nextCharge ? parseIsraeliDate(nextCharge).toISOString() : undefined,
      cardFrame: card.limitData && !Number.isNaN(frame) ? frame : undefined,
    };
  });
}
