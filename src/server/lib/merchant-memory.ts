import "server-only";

import { getDb } from "../db/index";
import type { CategoryKind } from "@/lib/types";

export function normalizeMerchant(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .trim();
}

/**
 * Other transactions from the same merchant as `id`: same normalized name
 * and the same direction (a refund is not a purchase). Transfers are left
 * out. `differentFrom` keeps only rows not already in that category.
 */
export function sameMerchantTransactionIds(
  workspaceId: number,
  id: number,
  differentFrom?: number
): number[] {
  const db = getDb();
  const base = db
    .prepare("SELECT description, charged_amount FROM transactions WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, id) as { description: string; charged_amount: number } | undefined;
  if (!base) return [];
  const key = normalizeMerchant(base.description);
  const outgoing = base.charged_amount < 0;
  const rows = db
    .prepare(
      `SELECT id, description, charged_amount, category_id FROM transactions
       WHERE workspace_id = ? AND id != ? AND kind != 'transfer'`
    )
    .all(workspaceId, id) as Array<{ id: number; description: string; charged_amount: number; category_id: number | null }>;
  return rows
    .filter(
      (r) =>
        r.charged_amount < 0 === outgoing &&
        (differentFrom === undefined || r.category_id !== differentFrom) &&
        normalizeMerchant(r.description) === key
    )
    .map((r) => r.id);
}

export interface MerchantMapping {
  merchantKey: string;
  categoryId: number;
  kind: CategoryKind;
  source: "user" | "approved-ai";
}

export function lookupMerchantCategory(
  workspaceId: number,
  description: string
): MerchantMapping | null {
  const key = normalizeMerchant(description);
  if (!key) return null;
  const row = getDb()
    .prepare(
      `SELECT merchant_key as merchantKey,
              category_id as categoryId,
              kind,
              source
       FROM merchant_categories
       WHERE workspace_id = ? AND merchant_key = ?`
    )
    .get(workspaceId, key) as MerchantMapping | undefined;
  return row ?? null;
}

export function lookupMerchantCategoriesBulk(
  workspaceId: number,
  descriptions: string[]
): Map<string, MerchantMapping> {
  if (descriptions.length === 0) return new Map();
  const keys = new Set<string>();
  const byKey = new Map<string, string>();
  for (const d of descriptions) {
    const k = normalizeMerchant(d);
    if (k) {
      keys.add(k);
      byKey.set(d, k);
    }
  }
  if (keys.size === 0) return new Map();
  const placeholders = Array.from(keys).map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT merchant_key as merchantKey,
              category_id as categoryId,
              kind,
              source
       FROM merchant_categories
       WHERE workspace_id = ? AND merchant_key IN (${placeholders})`
    )
    .all(workspaceId, ...Array.from(keys)) as MerchantMapping[];
  const lookupByKey = new Map<string, MerchantMapping>();
  for (const r of rows) lookupByKey.set(r.merchantKey, r);
  const result = new Map<string, MerchantMapping>();
  for (const [description, key] of byKey) {
    const m = lookupByKey.get(key);
    if (m) result.set(description, m);
  }
  return result;
}

export function recordMerchantCategory(
  workspaceId: number,
  description: string,
  categoryId: number,
  kind: CategoryKind,
  source: "user" | "approved-ai"
): void {
  const key = normalizeMerchant(description);
  if (!key) return;
  getDb()
    .prepare(
      `INSERT INTO merchant_categories
         (workspace_id, merchant_key, category_id, kind, source, hit_count)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(workspace_id, merchant_key) DO UPDATE SET
         category_id = excluded.category_id,
         kind = excluded.kind,
         source = CASE
           WHEN merchant_categories.source = 'user' AND excluded.source = 'approved-ai'
             THEN 'user'
           ELSE excluded.source
         END,
         updated_at = datetime('now')`
    )
    .run(workspaceId, key, categoryId, kind, source);
}

export function incrementMerchantHits(
  workspaceId: number,
  merchantKeys: string[]
): void {
  if (merchantKeys.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE merchant_categories SET hit_count = hit_count + 1 WHERE workspace_id = ? AND merchant_key = ?"
  );
  db.transaction(() => {
    for (const k of merchantKeys) stmt.run(workspaceId, k);
  })();
}
