import "server-only";

import { getDb } from "../db/index";
import { getGlobalSetting, setGlobalSetting } from "../db/queries/settings";
import { BANK_PROVIDERS } from "@/lib/types";
import type { CardAccount } from "@/lib/types";
import { detectKind } from "./transfers";
import { listRoutedOut } from "./card-routes";

/**
 * A card bill debit lands within a few days of the card's billing date
 * (weekends and bank holidays push it). Wider windows risk matching an
 * unrelated debit that happens to have the same amount.
 */
const MAX_DAYS_APART = 5;
/** Shekel rounding between the card statement and the bank debit. */
const AMOUNT_TOLERANCE = 1;

export function isCardProvider(provider: string): boolean {
  return BANK_PROVIDERS.find((p) => p.id === provider)?.kind === "card";
}

export function isBankAccountProvider(provider: string): boolean {
  return BANK_PROVIDERS.find((p) => p.id === provider)?.kind === "bank";
}

interface Cycle {
  accountNumber: string;
  processedDate: string;
  total: number;
}

interface Candidate {
  id: number;
  date: string;
}

const CYCLES_SQL = `
  SELECT account_number AS accountNumber, processed_date AS processedDate,
         -SUM(charged_amount) AS total
  FROM transactions
  WHERE workspace_id = ? AND credential_id = ? AND status = 'completed'
  GROUP BY account_number, processed_date
  HAVING total > 0`;

const CANDIDATES_SQL = `
  SELECT id, date
  FROM transactions
  WHERE workspace_id = ? AND credential_id = ?
    AND charged_amount < 0
    AND kind != 'income'
    AND card_bill_credential_id IS NULL
    AND ABS(-charged_amount - ?) <= ${AMOUNT_TOLERANCE}
    AND ABS(julianday(date) - julianday(?)) <= ${MAX_DAYS_APART}`;

/** One currency's share of a card statement. */
interface CyclePart {
  currency: string;
  /** In shekels, as the card company converted it. */
  ils: number;
  /** In the purchase currency. */
  original: number;
}

const CYCLE_PARTS_SQL = `
  SELECT CASE WHEN original_currency IS NULL OR original_currency IN ('ILS', '₪') THEN 'ILS'
              WHEN original_currency = '$' THEN 'USD' WHEN original_currency = '€' THEN 'EUR'
              WHEN original_currency = '£' THEN 'GBP' ELSE upper(original_currency) END AS currency,
         -SUM(charged_amount) AS ils, -SUM(original_amount) AS original
  FROM transactions
  WHERE workspace_id = ? AND credential_id = ? AND account_number = ? AND processed_date = ?
    AND status = 'completed'
  GROUP BY currency`;

/** A debit in a foreign currency account, matched in that currency. */
const FOREIGN_CANDIDATES_SQL = `
  SELECT id, date
  FROM transactions
  WHERE workspace_id = ? AND credential_id = ?
    AND original_amount < 0
    AND kind != 'income'
    AND card_bill_credential_id IS NULL
    AND upper(original_currency) = ?
    AND ABS(-original_amount - ?) <= 0.05
    AND ABS(julianday(date) - julianday(?)) <= ${MAX_DAYS_APART}`;

function closestTo(candidates: Candidate[], isoDate: string): Candidate {
  const target = Date.parse(isoDate);
  return candidates.reduce((a, b) =>
    Math.abs(Date.parse(a.date) - target) <= Math.abs(Date.parse(b.date) - target) ? a : b
  );
}

/**
 * Re-derives which bank debits settle which card statements for every linked
 * card in the workspace. Safe to run repeatedly: earlier matches are undone
 * first, so changing or removing a link fixes up past rows too.
 */
export function reconcileCardBills(workspaceId: number): void {
  const db = getDb();

  db.transaction(() => {
    // 1. Undo earlier matches: give each row back the kind the importer would
    //    have assigned on its own.
    const previous = db
      .prepare(
        `SELECT id, description, provider, charged_amount AS amount
         FROM transactions
         WHERE workspace_id = ? AND card_bill_credential_id IS NOT NULL`
      )
      .all(workspaceId) as { id: number; description: string; provider: string; amount: number }[];
    const reset = db.prepare(
      `UPDATE transactions
       SET kind = ?, card_bill_credential_id = NULL, card_bill_accounts = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    );
    for (const row of previous) {
      reset.run(detectKind(row.description, row.provider, row.amount), row.id);
    }

    // 2. Match per card, then try combined debits for leftovers.
    const links = db
      .prepare(
        `SELECT l.card_credential_id AS cardId, l.card_account_number AS account,
                l.bank_credential_id AS bankId
         FROM card_payment_links l
         WHERE l.workspace_id = ?`
      )
      .all(workspaceId) as { cardId: number; account: string; bankId: number }[];

    const cyclesStmt = db.prepare(CYCLES_SQL);
    const candidatesStmt = db.prepare(CANDIDATES_SQL);
    const partsStmt = db.prepare(CYCLE_PARTS_SQL);
    const foreignStmt = db.prepare(FOREIGN_CANDIDATES_SQL);
    const mark = db.prepare(
      `UPDATE transactions
       SET kind = 'transfer', card_bill_credential_id = ?, card_bill_accounts = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );

    // Group links by (card login, paying bank): cards in one group can share
    // a single combined debit.
    const groups = new Map<string, { cardId: number; bankId: number; accounts: Set<string> }>();
    for (const link of links) {
      const key = `${link.cardId}:${link.bankId}`;
      const group = groups.get(key) ?? { cardId: link.cardId, bankId: link.bankId, accounts: new Set() };
      group.accounts.add(link.account);
      groups.set(key, group);
    }

    for (const { cardId, bankId, accounts } of groups.values()) {
      const cycles = (cyclesStmt.all(workspaceId, cardId) as Cycle[]).filter((c) =>
        accounts.has(c.accountNumber)
      );
      const unmatched: Cycle[] = [];
      for (const cycle of cycles) {
        const found = candidatesStmt.all(
          workspaceId,
          bankId,
          cycle.total,
          cycle.processedDate
        ) as Candidate[];
        if (found.length === 0) {
          unmatched.push(cycle);
          continue;
        }
        mark.run(cardId, cycle.accountNumber, closestTo(found, cycle.processedDate).id);
      }

      // Several cards billed on the same date, paid by one debit.
      const byDate = new Map<string, Cycle[]>();
      for (const cycle of unmatched) {
        const day = cycle.processedDate.slice(0, 10);
        byDate.set(day, [...(byDate.get(day) ?? []), cycle]);
      }
      const stillUnmatched: Cycle[] = [];
      for (const sameDay of byDate.values()) {
        if (sameDay.length < 2) {
          stillUnmatched.push(...sameDay);
          continue;
        }
        const total = sameDay.reduce((s, c) => s + c.total, 0);
        const found = candidatesStmt.all(
          workspaceId,
          bankId,
          total,
          sameDay[0].processedDate
        ) as Candidate[];
        if (found.length === 0) {
          stillUnmatched.push(...sameDay);
          continue;
        }
        const accountList = sameDay.map((c) => c.accountNumber).sort().join(",");
        mark.run(cardId, accountList, closestTo(found, sameDay[0].processedDate).id);
      }

      // Some banks pay a statement in parts: the shekel purchases from the
      // shekel account, and each foreign currency's purchases in one debit
      // from that currency's account (Leumi does). Match each part on its own,
      // the foreign ones by their amount in that currency.
      for (const cycle of stillUnmatched) {
        const parts = partsStmt.all(
          workspaceId,
          cardId,
          cycle.accountNumber,
          cycle.processedDate
        ) as CyclePart[];
        if (parts.length < 2) continue;
        for (const part of parts) {
          const found = (
            part.currency === "ILS"
              ? part.ils > 0
                ? candidatesStmt.all(workspaceId, bankId, part.ils, cycle.processedDate)
                : []
              : part.original > 0
                ? foreignStmt.all(workspaceId, bankId, part.currency, part.original, cycle.processedDate)
                : []
          ) as Candidate[];
          if (found.length > 0) {
            mark.run(cardId, cycle.accountNumber, closestTo(found, cycle.processedDate).id);
          }
        }
      }
    }
  })();
}

/** Bumped when the matching rules change, so bills matched under the old ones are matched again. */
const MATCHING_VERSION = "2";

/** Re-matches every workspace once after the rules change (on startup), instead of waiting for each sync. */
export function reconcileAfterUpgrade(): void {
  if (getGlobalSetting("card_bill_matching") === MATCHING_VERSION) return;
  const workspaces = getDb().prepare("SELECT id FROM workspaces").all() as { id: number }[];
  for (const { id } of workspaces) reconcileCardBills(id);
  setGlobalSetting("card_bill_matching", MATCHING_VERSION);
}

/** Links one card to the bank login that pays it, or clears the link. */
export function setCardPaymentLink(
  workspaceId: number,
  cardCredentialId: number,
  cardAccountNumber: string,
  bankCredentialId: number | null
): void {
  const db = getDb();
  if (bankCredentialId === null) {
    db.prepare(
      `DELETE FROM card_payment_links
       WHERE workspace_id = ? AND card_credential_id = ? AND card_account_number = ?`
    ).run(workspaceId, cardCredentialId, cardAccountNumber);
    return;
  }
  db.prepare(
    `INSERT INTO card_payment_links
       (workspace_id, card_credential_id, card_account_number, bank_credential_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, card_credential_id, card_account_number)
     DO UPDATE SET bank_credential_id = excluded.bank_credential_id`
  ).run(workspaceId, cardCredentialId, cardAccountNumber, bankCredentialId);
}

/**
 * The cards seen under one card login, with their current link, how many of
 * their bills are matched, and a suggested paying bank for unlinked cards.
 */
export function listCardAccounts(workspaceId: number, cardCredentialId: number): CardAccount[] {
  const db = getDb();
  const cards = db
    .prepare(
      `SELECT account_number AS accountNumber, COUNT(*) AS purchaseCount,
              MAX(date) AS lastPurchaseAt
       FROM transactions
       WHERE workspace_id = ? AND credential_id = ?
       GROUP BY account_number
       ORDER BY lastPurchaseAt DESC`
    )
    .all(workspaceId, cardCredentialId) as {
    accountNumber: string;
    purchaseCount: number;
    lastPurchaseAt: string;
  }[];

  const links = new Map(
    (
      db
        .prepare(
          `SELECT card_account_number AS account, bank_credential_id AS bankId
           FROM card_payment_links WHERE workspace_id = ? AND card_credential_id = ?`
        )
        .all(workspaceId, cardCredentialId) as { account: string; bankId: number }[]
    ).map((l) => [l.account, l.bankId])
  );

  const matchedRows = db
    .prepare(
      `SELECT card_bill_accounts AS accounts
       FROM transactions
       WHERE workspace_id = ? AND card_bill_credential_id = ?`
    )
    .all(workspaceId, cardCredentialId) as { accounts: string | null }[];
  const matched = new Map<string, number>();
  for (const row of matchedRows) {
    for (const account of (row.accounts ?? "").split(",").filter(Boolean)) {
      matched.set(account, (matched.get(account) ?? 0) + 1);
    }
  }

  const banks = (
    db
      .prepare("SELECT id, provider FROM bank_credentials WHERE workspace_id = ?")
      .all(workspaceId) as { id: number; provider: string }[]
  ).filter((b) => isBankAccountProvider(b.provider));
  const cycles = db.prepare(CYCLES_SQL).all(workspaceId, cardCredentialId) as Cycle[];
  // Suggestions ignore existing matches, so they also see debits another card
  // already claimed. Good enough for a hint; the user confirms it.
  const probe = db.prepare(
    `SELECT 1 FROM transactions
     WHERE workspace_id = ? AND credential_id = ? AND charged_amount < 0
       AND kind != 'income'
       AND ABS(-charged_amount - ?) <= ${AMOUNT_TOLERANCE}
       AND ABS(julianday(date) - julianday(?)) <= ${MAX_DAYS_APART}
     LIMIT 1`
  );

  // Cards of this login moved to other workspaces: listed so they can be
  // brought back, with their purchases counted where they now live.
  const elsewhere: CardAccount[] = [];
  const home = db
    .prepare("SELECT workspace_id AS workspaceId FROM bank_credentials WHERE id = ?")
    .get(cardCredentialId) as { workspaceId: number } | undefined;
  if (home?.workspaceId === workspaceId) {
    const countIn = db.prepare(
      `SELECT COUNT(*) AS n, MAX(date) AS last FROM transactions
       WHERE workspace_id = ? AND credential_id = ? AND account_number = ?`
    );
    for (const out of listRoutedOut(cardCredentialId)) {
      const stats = countIn.get(out.workspaceId, cardCredentialId, out.accountNumber) as {
        n: number;
        last: string | null;
      };
      elsewhere.push({
        accountNumber: out.accountNumber,
        purchaseCount: stats.n,
        lastPurchaseAt: stats.last ?? "",
        billingCycles: 0,
        paidFromCredentialId: null,
        matchedBills: 0,
        suggestion: null,
        elsewhere: { workspaceId: out.workspaceId, workspaceName: out.workspaceName },
      });
    }
  }

  const here = cards.map((card): CardAccount => {
    const cardCycles = cycles.filter((c) => c.accountNumber === card.accountNumber);
    let suggestion: CardAccount["suggestion"] = null;
    if (!links.has(card.accountNumber)) {
      for (const bank of banks) {
        const hits = cardCycles.filter((c) =>
          probe.get(workspaceId, bank.id, c.total, c.processedDate)
        ).length;
        if (hits > 0 && (!suggestion || hits > suggestion.matchingBills)) {
          suggestion = { bankCredentialId: bank.id, matchingBills: hits };
        }
      }
    }
    return {
      accountNumber: card.accountNumber,
      purchaseCount: card.purchaseCount,
      lastPurchaseAt: card.lastPurchaseAt,
      billingCycles: cardCycles.length,
      paidFromCredentialId: links.get(card.accountNumber) ?? null,
      matchedBills: matched.get(card.accountNumber) ?? 0,
      suggestion,
      elsewhere: null,
    };
  });
  return [...here, ...elsewhere];
}

/** How many bank debits are currently matched to each card login. */
export function getCardBillMatchCounts(workspaceId: number): Map<number, number> {
  const rows = getDb()
    .prepare(
      `SELECT card_bill_credential_id AS cardId, COUNT(*) AS count
       FROM transactions
       WHERE workspace_id = ? AND card_bill_credential_id IS NOT NULL
       GROUP BY card_bill_credential_id`
    )
    .all(workspaceId) as { cardId: number; count: number }[];
  return new Map(rows.map((r) => [r.cardId, r.count]));
}

/** Accounts seen under each login, e.g. the separate cards in one Cal login. */
export function getLoginAccounts(
  workspaceId: number
): Map<number, { accountNumber: string; transactionCount: number }[]> {
  const rows = getDb()
    .prepare(
      `SELECT credential_id AS credentialId, account_number AS accountNumber,
              COUNT(*) AS transactionCount
       FROM transactions
       WHERE workspace_id = ? AND credential_id IS NOT NULL
       GROUP BY credential_id, account_number
       ORDER BY credential_id, transactionCount DESC`
    )
    .all(workspaceId) as { credentialId: number; accountNumber: string; transactionCount: number }[];
  const map = new Map<number, { accountNumber: string; transactionCount: number }[]>();
  for (const r of rows) {
    const list = map.get(r.credentialId) ?? [];
    list.push({ accountNumber: r.accountNumber, transactionCount: r.transactionCount });
    map.set(r.credentialId, list);
  }
  return map;
}

/** How many cards are linked to each bank login as "Paid from". */
export function getLinkedCardCounts(workspaceId: number): Map<number, number> {
  const rows = getDb()
    .prepare(
      `SELECT bank_credential_id AS bankId, COUNT(*) AS count
       FROM card_payment_links WHERE workspace_id = ?
       GROUP BY bank_credential_id`
    )
    .all(workspaceId) as { bankId: number; count: number }[];
  return new Map(rows.map((r) => [r.bankId, r.count]));
}
