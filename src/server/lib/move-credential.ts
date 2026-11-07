import "server-only";

import { getDb } from "../db/index";
import { reconcileCardBills } from "./card-bills";

/**
 * Moving a bank login to another workspace, for when it was connected to the
 * wrong one. The login keeps its encrypted credentials, transactions and sync
 * history. What doesn't travel:
 *
 * - Categories are per workspace, so each transaction is re-pointed at the
 *   same-named category in the target. Names with no match there are left
 *   uncategorized for the next Categorize run.
 * - Card payment links connect two logins in one workspace. Links between the
 *   moved login and logins staying behind are removed, and card bill matching
 *   is redone in both workspaces.
 * - Transactions the target already has (same dedup hash, e.g. the same bank
 *   connected there too) are dropped from the moved set instead of colliding.
 *
 * Workspace-wide rules (merchant memory, corrections, excluded merchants)
 * stay where they are.
 */

export interface MovePreview {
  transactionCount: number;
  duplicateCount: number;
  /** Category names used by the login that the target workspace doesn't have. */
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

function validate({ credentialId, fromWorkspaceId, toWorkspaceId }: Context): void {
  const db = getDb();
  if (fromWorkspaceId === toWorkspaceId) {
    throw new MoveError("It's already in this workspace.", 400);
  }
  const login = db
    .prepare("SELECT provider, label FROM bank_credentials WHERE id = ? AND workspace_id = ?")
    .get(credentialId, fromWorkspaceId) as { provider: string; label: string } | undefined;
  if (!login) throw new MoveError("This bank login wasn't found.", 404);

  if (!db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(toWorkspaceId)) {
    throw new MoveError("That workspace doesn't exist.", 404);
  }
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
  const running = db
    .prepare("SELECT 1 FROM sync_runs WHERE credential_id = ? AND status = 'running'")
    .get(credentialId);
  if (running) {
    throw new MoveError("This bank is syncing right now. Try again when it finishes.", 409);
  }
}

function buildPreview({ credentialId, fromWorkspaceId, toWorkspaceId }: Context): MovePreview {
  const db = getDb();
  const transactionCount = (
    db
      .prepare("SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ? AND credential_id = ?")
      .get(fromWorkspaceId, credentialId) as { n: number }
  ).n;

  const duplicateCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions t
         WHERE t.workspace_id = ? AND t.credential_id = ?
           AND EXISTS (
             SELECT 1 FROM transactions o
             WHERE o.workspace_id = ? AND o.dedup_hash = t.dedup_hash
               AND o.dedup_sequence = t.dedup_sequence
           )`
      )
      .get(fromWorkspaceId, credentialId, toWorkspaceId) as { n: number }
  ).n;

  const unmatched = db
    .prepare(
      `SELECT c.name AS name, COUNT(*) AS n
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = ? AND t.credential_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM categories d
           WHERE d.workspace_id = ? AND lower(d.name) = lower(c.name) AND d.kind = c.kind
         )
       GROUP BY c.name
       ORDER BY n DESC`
    )
    .all(fromWorkspaceId, credentialId, toWorkspaceId) as { name: string; n: number }[];

  const removedLinkCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM card_payment_links
         WHERE workspace_id = ? AND (card_credential_id = ? OR bank_credential_id = ?)`
      )
      .get(fromWorkspaceId, credentialId, credentialId) as { n: number }
  ).n;

  return {
    transactionCount,
    duplicateCount,
    unmatchedCategories: unmatched.map((u) => u.name),
    uncategorizedCount: unmatched.reduce((s, u) => s + u.n, 0),
    removedLinkCount,
  };
}

export function previewCredentialMove(ctx: Context): MovePreview {
  validate(ctx);
  return buildPreview(ctx);
}

export function moveCredential(ctx: Context): MoveResult {
  const { credentialId, fromWorkspaceId: from, toWorkspaceId: to } = ctx;
  const db = getDb();

  const result = db.transaction((): MoveResult => {
    validate(ctx);
    const preview = buildPreview(ctx);

    // Links can't span workspaces. reconcileCardBills below undoes the bill
    // matches they produced.
    db.prepare(
      `DELETE FROM card_payment_links
       WHERE workspace_id = ? AND (card_credential_id = ? OR bank_credential_id = ?)`
    ).run(from, credentialId, credentialId);

    db.prepare(
      `DELETE FROM transactions AS t
       WHERE t.workspace_id = ? AND t.credential_id = ?
         AND EXISTS (
           SELECT 1 FROM transactions o
           WHERE o.workspace_id = ? AND o.dedup_hash = t.dedup_hash
             AND o.dedup_sequence = t.dedup_sequence
         )`
    ).run(from, credentialId, to);

    // Re-point categories by name. The subquery is NULL where the target has
    // no match, which leaves the row uncategorized.
    db.prepare(
      `UPDATE transactions
       SET category_id = (
             SELECT d.id FROM categories c
             JOIN categories d ON d.workspace_id = ? AND lower(d.name) = lower(c.name)
                              AND d.kind = c.kind
             WHERE c.id = transactions.category_id
           ),
           workspace_id = ?,
           updated_at = datetime('now')
       WHERE workspace_id = ? AND credential_id = ?`
    ).run(to, to, from, credentialId);

    db.prepare(
      `UPDATE transactions
       SET category_source = NULL, needs_review = 0, ai_confidence = NULL
       WHERE workspace_id = ? AND credential_id = ? AND category_id IS NULL`
    ).run(to, credentialId);

    db.prepare("UPDATE sync_runs SET workspace_id = ? WHERE credential_id = ?").run(
      to,
      credentialId
    );
    db.prepare(
      "UPDATE bank_credentials SET workspace_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(to, credentialId);

    return { ...preview, movedCount: preview.transactionCount - preview.duplicateCount };
  })();

  reconcileCardBills(from);
  reconcileCardBills(to);
  return result;
}
