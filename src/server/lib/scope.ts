import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getDb } from "../db/index";
import { isBankAccountProvider } from "./card-bills";

/**
 * Budget scope: which accounts the totals cover. A user can narrow the whole
 * app to one or more bank "bundles". A bundle is a bank login plus every card
 * linked to it as "Paid from" that bank, so a card billed to another bank
 * (say a OneZero card) drops out of a Leumi-only view.
 *
 * The client sends the chosen bank login ids in the X-Spent-Scope header. A
 * route opts in by running its work inside `withRequestScope`, and the shared
 * SQL conditions (countedSql and friends) read the active scope from here.
 * That keeps the scope out of dozens of query function signatures.
 */

export const SCOPE_HEADER = "x-spent-scope";

interface ResolvedScope {
  /** Bank logins whose every account is in scope. */
  credentialIds: number[];
  /** Individual cards in scope: a card login id plus the card's account number. */
  cards: { credentialId: number; accountNumber: string }[];
}

const storage = new AsyncLocalStorage<ResolvedScope | null>();

// Card account numbers are short digit strings. Anything else is dropped
// rather than quoted into SQL.
const SAFE_ACCOUNT = /^[A-Za-z0-9-]{1,32}$/;

function parseHeader(request: Request): number[] {
  const raw = request.headers.get(SCOPE_HEADER);
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function resolve(workspaceId: number, bankIds: number[]): ResolvedScope | null {
  if (bankIds.length === 0) return null;
  const db = getDb();
  const placeholders = bankIds.map(() => "?").join(",");
  const banks = (
    db
      .prepare(
        `SELECT id, provider FROM bank_credentials WHERE workspace_id = ? AND id IN (${placeholders})`
      )
      .all(workspaceId, ...bankIds) as { id: number; provider: string }[]
  ).filter((b) => isBankAccountProvider(b.provider));
  if (banks.length === 0) return null;

  const ids = banks.map((b) => b.id);
  const cards = (
    db
      .prepare(
        `SELECT card_credential_id AS credentialId, card_account_number AS accountNumber
         FROM card_payment_links
         WHERE workspace_id = ? AND bank_credential_id IN (${ids.map(() => "?").join(",")})`
      )
      .all(workspaceId, ...ids) as { credentialId: number; accountNumber: string }[]
  ).filter((c) => SAFE_ACCOUNT.test(c.accountNumber));

  return { credentialIds: ids, cards };
}

/** Runs `fn` with the request's budget scope active for every query inside it. */
export function withRequestScope<T>(request: Request, workspaceId: number, fn: () => T): T {
  return storage.run(resolve(workspaceId, parseHeader(request)), fn);
}

/**
 * SQL condition limiting rows to the active scope, or "1 = 1" when the whole
 * workspace is in view. Values are integers and validated account numbers,
 * inlined so callers don't need to thread parameters through.
 */
export function scopeSql(alias?: string): string {
  const scope = storage.getStore();
  if (!scope) return "1 = 1";
  const p = alias ? `${alias}.` : "";
  const parts: string[] = [];
  if (scope.credentialIds.length > 0) {
    parts.push(`${p}credential_id IN (${scope.credentialIds.join(",")})`);
  }
  for (const card of scope.cards) {
    parts.push(`(${p}credential_id = ${card.credentialId} AND ${p}account_number = '${card.accountNumber}')`);
  }
  return parts.length > 0 ? `(${parts.join(" OR ")})` : "1 = 0";
}
