import "server-only";

import { getDb } from "../db";
import { recordCorrection } from "../db/queries/category-corrections";
import { getAllCategories } from "../db/queries/categories";
import {
  getTransactionContext,
  setTransactionNeedsReview,
  updateTransactionCategory,
} from "../db/queries/transactions";
import { recordMerchantCategory, sameMerchantTransactionIds } from "./merchant-memory";

/**
 * The owner choosing a category for a transaction: from the Transactions page,
 * or by approving a viewer's suggestion. Remembers it for the merchant and,
 * when it overrides the AI, logs a correction so the categorizer learns.
 *
 * With `applyToMerchant`, every other transaction from the same merchant
 * (same direction) gets it too. Returns how many others were changed, and how
 * many others still have a different category.
 */
export function applyCategoryChange(
  workspaceId: number,
  transactionId: number,
  categoryId: number,
  applyToMerchant = false
): { found: boolean; applied: number; sameMerchantCount: number } {
  const before = getTransactionContext(workspaceId, transactionId);
  if (!before) return { found: false, applied: 0, sameMerchantCount: 0 };
  updateTransactionCategory(workspaceId, transactionId, categoryId, "user");
  setTransactionNeedsReview(workspaceId, transactionId, false);

  // The user's choice, so it wins over AI categories and clears review flags.
  let applied = 0;
  if (applyToMerchant) {
    const ids = sameMerchantTransactionIds(workspaceId, transactionId, categoryId);
    const update = getDb().prepare(
      `UPDATE transactions
       SET category_id = ?, category_source = 'user', needs_review = 0, ai_confidence = NULL, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    );
    getDb().transaction(() => {
      for (const other of ids) applied += update.run(categoryId, workspaceId, other).changes;
    })();
  }

  if (before.kind === "expense" || before.kind === "income") {
    const category = getAllCategories(workspaceId).find((c) => c.id === categoryId);
    if (category && (category.kind === "expense" || category.kind === "income")) {
      recordMerchantCategory(workspaceId, before.description, categoryId, category.kind, "user");
      if (before.categorySource === "ai" && before.categoryId != null && before.categoryId !== categoryId) {
        recordCorrection(workspaceId, before.description, before.categoryId, categoryId, category.kind);
      }
    }
  }

  return {
    found: true,
    applied,
    sameMerchantCount: applyToMerchant ? 0 : sameMerchantTransactionIds(workspaceId, transactionId, categoryId).length,
  };
}
