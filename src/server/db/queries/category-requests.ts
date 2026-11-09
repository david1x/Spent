import "server-only";

import { getDb } from "../index";
import { applyCategoryChange } from "../../lib/category-change";
import type { CategoryRequest } from "@/lib/types";

/**
 * A viewer's suggested category for a transaction. Nothing changes until the
 * owner approves it; approving applies it exactly as if the owner had picked
 * it on the Transactions page.
 */

const MAX_NOTE = 280;

interface Row {
  id: number;
  transaction_id: number;
  viewer_id: number | null;
  requested_by: string;
  note: string | null;
  status: CategoryRequest["status"];
  created_at: string;
  decided_at: string | null;
  from_category_id: number | null;
  from_name: string | null;
  from_color: string | null;
  to_category_id: number;
  to_name: string;
  to_color: string;
  description: string;
  display_name: string | null;
  charged_amount: number;
  date: string;
  current_category_id: number | null;
}

const SELECT = `
  SELECT r.id, r.transaction_id, r.viewer_id, r.requested_by, r.note, r.status, r.created_at, r.decided_at,
         r.from_category_id, fc.name AS from_name, fc.color AS from_color,
         r.to_category_id, tc.name AS to_name, tc.color AS to_color,
         t.description, t.display_name, t.charged_amount, t.date, t.category_id AS current_category_id
  FROM category_requests r
  JOIN transactions t ON t.id = r.transaction_id
  JOIN categories tc ON tc.id = r.to_category_id
  LEFT JOIN categories fc ON fc.id = r.from_category_id`;

function mapRow(r: Row): CategoryRequest {
  return {
    id: r.id,
    transactionId: r.transaction_id,
    requestedBy: r.requested_by,
    viewerId: r.viewer_id,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    from: r.from_category_id != null && r.from_name ? { id: r.from_category_id, name: r.from_name, color: r.from_color ?? "" } : null,
    to: { id: r.to_category_id, name: r.to_name, color: r.to_color },
    transaction: {
      description: r.description,
      displayName: r.display_name,
      chargedAmount: r.charged_amount,
      date: r.date,
      currentCategoryId: r.current_category_id,
    },
  };
}

export function listPendingCategoryRequests(workspaceId: number): CategoryRequest[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE r.workspace_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC, r.id DESC`)
    .all(workspaceId) as Row[];
  return rows.map(mapRow);
}

export class CategoryRequestError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/** Saves a suggestion, replacing the viewer's earlier open one for the same transaction. */
export function createCategoryRequest(
  workspaceId: number,
  viewer: { id: number; username: string },
  transactionId: number,
  categoryId: number,
  note: string | null
): CategoryRequest {
  const db = getDb();
  const txn = db
    .prepare("SELECT id, category_id, charged_amount, kind FROM transactions WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, transactionId) as
    | { id: number; category_id: number | null; charged_amount: number; kind: string }
    | undefined;
  if (!txn) throw new CategoryRequestError("That transaction isn't here.", 404);
  const category = db
    .prepare("SELECT id, kind FROM categories WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, categoryId) as { id: number; kind: string } | undefined;
  if (!category) throw new CategoryRequestError("That category isn't here.", 404);
  // Same rule as the category menu: money in gets income categories, money out expense ones.
  const wantedKind = txn.charged_amount > 0 ? "income" : "expense";
  if (category.kind !== wantedKind) throw new CategoryRequestError("That category doesn't fit this transaction.");
  if (txn.category_id === categoryId) throw new CategoryRequestError("It already has that category.");

  const cleanNote = note?.trim().slice(0, MAX_NOTE) || null;
  const id = db.transaction(() => {
    db.prepare("DELETE FROM category_requests WHERE transaction_id = ? AND status = 'pending'").run(transactionId);
    return Number(
      db
        .prepare(
          `INSERT INTO category_requests
             (workspace_id, transaction_id, viewer_id, requested_by, from_category_id, to_category_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(workspaceId, transactionId, viewer.id, viewer.username, txn.category_id, categoryId, cleanNote)
        .lastInsertRowid
    );
  })();
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row;
  return mapRow(row);
}

/** A viewer taking back their own open suggestion. */
export function withdrawCategoryRequest(workspaceId: number, viewerId: number, id: number): boolean {
  return (
    getDb()
      .prepare("DELETE FROM category_requests WHERE id = ? AND workspace_id = ? AND viewer_id = ? AND status = 'pending'")
      .run(id, workspaceId, viewerId).changes > 0
  );
}

/** The owner's answer. Approving sets the category; either way the suggestion closes. */
export function decideCategoryRequests(
  workspaceId: number,
  ids: number[],
  decision: "approve" | "decline"
): { decided: number } {
  const db = getDb();
  const pick = db.prepare(
    "SELECT id, transaction_id, to_category_id FROM category_requests WHERE id = ? AND workspace_id = ? AND status = 'pending'"
  );
  const close = db.prepare("UPDATE category_requests SET status = ?, decided_at = datetime('now') WHERE id = ?");
  let decided = 0;
  db.transaction(() => {
    for (const id of new Set(ids)) {
      const req = pick.get(id, workspaceId) as { id: number; transaction_id: number; to_category_id: number } | undefined;
      if (!req) continue;
      if (decision === "approve") applyCategoryChange(workspaceId, req.transaction_id, req.to_category_id);
      close.run(decision === "approve" ? "approved" : "declined", req.id);
      decided++;
    }
  })();
  return { decided };
}
