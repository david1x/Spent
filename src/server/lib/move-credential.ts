import "server-only";

import { getDb } from "../db/index";
import { isCardProvider, reconcileCardBills } from "./card-bills";
import { getCardWorkspace, getLoginHome, setCardRoute } from "./card-routes";

/**
 * Moving a bank login, or one card under a card login, to another workspace,
 * for when it was connected to the wrong one.
 *
 * A login keeps its encrypted credentials, transactions and sync history. A
 * single card moves its transactions and gets a route (see card-routes.ts) so
 * later syncs of its login keep sending it there. What doesn't travel:
 *
 * - Categories are per workspace, so each transaction is re-pointed at the
 *   same-named category in the target. Names with no match there are left
 *   uncategorized for the next Categorize run.
 * - Card payment links connect a card to a bank in one workspace. Links that
 *   would end up spanning workspaces are removed, and card bill matching is
 *   redone in both workspaces.
 * - Transactions the target already has (same dedup hash, e.g. the same bank
 *   connected there too) are dropped from the moved set instead of colliding.
 *
 * Workspace-wide rules (merchant memory, corrections, excluded merchants)
 * stay where they are.
 */

export interface MovePreview {
  transactionCount: number;
  duplicateCount: number;
  /** Category names used by the moved rows that the target workspace doesn't have. */
  unmatchedCategories: string[];
  uncategorizedCount: number;
  removedLinkCount: number;
}

export interface MoveResult extends MovePreview {
  movedCount: number;
}

export class MoveError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

interface Context {
  credentialId: number;
  fromWorkspaceId: number;
  toWorkspaceId: number;
}

interface CardContext extends Context {
  accountNumber: string;
}

/** Which transactions move: a login's rows, or one card's rows. */
interface RowFilter {
  sql: string;
  params: (number | string)[];
}

function loginRows(credentialId: number): RowFilter {
  return { sql: "t.credential_id = ?", params: [credentialId] };
}

function cardRows(credentialId: number, accountNumber: string): RowFilter {
  return {
    sql: "t.credential_id = ? AND t.account_number = ?",
    params: [credentialId, accountNumber],
  };
}

function assertMovable(credentialId: number, fromWorkspaceId: number, toWorkspaceId: number): void {
  const db = getDb();
  if (fromWorkspaceId === toWorkspaceId) {
    throw new MoveError("It's already in this workspace.", 400);
  }
  if (!db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(toWorkspaceId)) {
    throw new MoveError("That workspace doesn't exist.", 404);
  }
  const running = db
    .prepare("SELECT 1 FROM sync_runs WHERE credential_id = ? AND status = 'running'")
    .get(credentialId);
  if (running) {
    throw new MoveError("This bank is syncing right now. Try again when it finishes.", 409);
  }
}

function previewRows(
  filter: RowFilter,
  from: number,
  to: number,
  removedLinkCount: number
): MovePreview {
  const db = getDb();
  const transactionCount = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE t.workspace_id = ? AND ${filter.sql}`)
      .get(from, ...filter.params) as { n: number }
  ).n;

  const duplicateCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions t
         WHERE t.workspace_id = ? AND ${filter.sql}
           AND EXISTS (
             SELECT 1 FROM transactions o
             WHERE o.workspace_id = ? AND o.dedup_hash = t.dedup_hash
               AND o.dedup_sequence = t.dedup_sequence
           )`
      )
      .get(from, ...filter.params, to) as { n: number }
  ).n;

  const unmatched = db
    .prepare(
      `SELECT c.name AS name, COUNT(*) AS n
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = ? AND ${filter.sql}
         AND NOT EXISTS (
           SELECT 1 FROM categories d
           WHERE d.workspace_id = ? AND lower(d.name) = lower(c.name) AND d.kind = c.kind
         )
       GROUP BY c.name
       ORDER BY n DESC`
    )
    .all(from, ...filter.params, to) as { name: string; n: number }[];

  return {
    transactionCount,
    duplicateCount,
    unmatchedCategories: unmatched.map((u) => u.name),
    uncategorizedCount: unmatched.reduce((s, u) => s + u.n, 0),
    removedLinkCount,
  };
}

/** Moves the filtered rows, dropping ones the target already has. Run inside a transaction. */
function moveRows(filter: RowFilter, from: number, to: number): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM transactions AS t
     WHERE t.workspace_id = ? AND ${filter.sql}
       AND EXISTS (
         SELECT 1 FROM transactions o
         WHERE o.workspace_id = ? AND o.dedup_hash = t.dedup_hash
           AND o.dedup_sequence = t.dedup_sequence
       )`
  ).run(from, ...filter.params, to);

  // The subquery is NULL where the target has no same-named category, which
  // leaves the row uncategorized.
  db.prepare(
    `UPDATE transactions AS t
     SET category_id = (
           SELECT d.id FROM categories c
           JOIN categories d ON d.workspace_id = ? AND lower(d.name) = lower(c.name)
                            AND d.kind = c.kind
           WHERE c.id = t.category_id
         ),
         workspace_id = ?,
         updated_at = datetime('now')
     WHERE t.workspace_id = ? AND ${filter.sql}`
  ).run(to, to, from, ...filter.params);

  db.prepare(
    `UPDATE transactions AS t
     SET category_source = NULL, needs_review = 0, ai_confidence = NULL
     WHERE t.workspace_id = ? AND ${filter.sql} AND t.category_id IS NULL`
  ).run(to, ...filter.params);
}

// ---------------------------------------------------------------------------
// Whole login

function validateLogin({ credentialId, fromWorkspaceId, toWorkspaceId }: Context): void {
  const db = getDb();
  const login = db
    .prepare("SELECT provider, label FROM bank_credentials WHERE id = ? AND workspace_id = ?")
    .get(credentialId, fromWorkspaceId) as { provider: string; label: string } | undefined;
  if (!login) throw new MoveError("This bank login wasn't found.", 404);
  assertMovable(credentialId, fromWorkspaceId, toWorkspaceId);

  const clash = db
    .prepare(
      "SELECT 1 FROM bank_credentials WHERE workspace_id = ? AND provider = ? AND label = ?"
    )
    .get(toWorkspaceId, login.provider, login.label);
  if (clash) {
    throw new MoveError(
      "That workspace already has a login with the same bank and name. Rename one of them first.",
      409
    );
  }
}

function loginLinkCount(credentialId: number, from: number): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM card_payment_links
         WHERE workspace_id = ? AND (card_credential_id = ? OR bank_credential_id = ?)`
      )
      .get(from, credentialId, credentialId) as { n: number }
  ).n;
}

export function previewCredentialMove(ctx: Context): MovePreview {
  validateLogin(ctx);
  const { credentialId, fromWorkspaceId: from, toWorkspaceId: to } = ctx;
  return previewRows(loginRows(credentialId), from, to, loginLinkCount(credentialId, from));
}

export function moveCredential(ctx: Context): MoveResult {
  const { credentialId, fromWorkspaceId: from, toWorkspaceId: to } = ctx;
  const db = getDb();

  const result = db.transaction((): MoveResult => {
    validateLogin(ctx);
    const filter = loginRows(credentialId);
    const preview = previewRows(filter, from, to, loginLinkCount(credentialId, from));

    // reconcileCardBills below undoes the bill matches these links produced.
    db.prepare(
      `DELETE FROM card_payment_links
       WHERE workspace_id = ? AND (card_credential_id = ? OR bank_credential_id = ?)`
    ).run(from, credentialId, credentialId);

    // Only the rows living with the login move. Cards already routed to
    // other workspaces stay where they are.
    moveRows(filter, from, to);

    db.prepare("UPDATE sync_runs SET workspace_id = ? WHERE credential_id = ?").run(
      to,
      credentialId
    );
    db.prepare(
      "UPDATE bank_credentials SET workspace_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(to, credentialId);
    // Cards that had been routed to the new home now simply live with it.
    db.prepare(
      "DELETE FROM card_workspace_routes WHERE credential_id = ? AND workspace_id = ?"
    ).run(credentialId, to);

    return { ...preview, movedCount: preview.transactionCount - preview.duplicateCount };
  })();

  reconcileCardBills(from);
  reconcileCardBills(to);
  return result;
}

// ---------------------------------------------------------------------------
// One card

/**
 * Checks the move and returns the workspace the card's rows are in now.
 * `fromWorkspaceId` is the workspace asking: where the card lives, or its
 * login's own workspace (which can bring back a card it moved out).
 */
function validateCard(ctx: CardContext): number {
  const { credentialId, accountNumber, fromWorkspaceId: asking, toWorkspaceId } = ctx;
  const home = getLoginHome(credentialId);
  if (!home || !isCardProvider(home.provider)) {
    throw new MoveError("This card wasn't found.", 404);
  }
  const location = getCardWorkspace(credentialId, accountNumber);
  if (location === null || (location !== asking && home.workspaceId !== asking)) {
    throw new MoveError("This card isn't in this workspace.", 404);
  }
  const seen = getDb()
    .prepare(
      "SELECT 1 FROM transactions WHERE credential_id = ? AND account_number = ? LIMIT 1"
    )
    .get(credentialId, accountNumber);
  if (!seen) throw new MoveError("This card wasn't found.", 404);
  assertMovable(credentialId, location, toWorkspaceId);
  return location;
}

function cardLinkCount(credentialId: number, accountNumber: string): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM card_payment_links
         WHERE card_credential_id = ? AND card_account_number = ?`
      )
      .get(credentialId, accountNumber) as { n: number }
  ).n;
}

export function previewCardMove(ctx: CardContext): MovePreview {
  const from = validateCard(ctx);
  const { credentialId, accountNumber, toWorkspaceId: to } = ctx;
  return previewRows(
    cardRows(credentialId, accountNumber),
    from,
    to,
    cardLinkCount(credentialId, accountNumber)
  );
}

export function moveCard(ctx: CardContext): MoveResult {
  const { credentialId, accountNumber, toWorkspaceId: to } = ctx;
  const db = getDb();
  let from = ctx.fromWorkspaceId;

  const result = db.transaction((): MoveResult => {
    from = validateCard(ctx);
    const filter = cardRows(credentialId, accountNumber);
    const preview = previewRows(filter, from, to, cardLinkCount(credentialId, accountNumber));

    // The paying bank is in the workspace the card leaves.
    db.prepare(
      "DELETE FROM card_payment_links WHERE card_credential_id = ? AND card_account_number = ?"
    ).run(credentialId, accountNumber);
    moveRows(filter, from, to);
    setCardRoute(credentialId, accountNumber, to);

    return { ...preview, movedCount: preview.transactionCount - preview.duplicateCount };
  })();

  reconcileCardBills(from);
  reconcileCardBills(to);
  return result;
}
