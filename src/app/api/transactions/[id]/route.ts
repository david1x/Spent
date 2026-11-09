import { NextResponse } from "next/server";
import {
  updateTransactionCategory,
  setTransactionKind,
  setTransactionNeedsReview,
  getTransactionContext,
  setTransactionText,
} from "@/server/db/queries/transactions";
import { recordMerchantCategory, sameMerchantTransactionIds } from "@/server/lib/merchant-memory";
import { getDb } from "@/server/db";
import { recordCorrection } from "@/server/db/queries/category-corrections";
import { getAllCategories } from "@/server/db/queries/categories";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const body = (await request.json()) as { categoryId: number; applyToMerchant?: boolean };

  if (!body.categoryId) {
    return NextResponse.json(
      { error: "categoryId is required" },
      { status: 400 }
    );
  }

  const numericId = Number(id);

  const before = getTransactionContext(workspaceId, numericId);
  updateTransactionCategory(workspaceId, numericId, body.categoryId, "user");
  setTransactionNeedsReview(workspaceId, numericId, false);

  // "Apply to all from this merchant": the user's choice, so it wins over
  // AI categories and clears their review flags.
  let applied = 0;
  if (body.applyToMerchant === true && before) {
    const ids = sameMerchantTransactionIds(workspaceId, numericId, body.categoryId);
    const update = getDb().prepare(
      `UPDATE transactions
       SET category_id = ?, category_source = 'user', needs_review = 0, ai_confidence = NULL, updated_at = datetime('now')
       WHERE workspace_id = ? AND id = ?`
    );
    getDb().transaction(() => {
      for (const other of ids) applied += update.run(body.categoryId, workspaceId, other).changes;
    })();
  }

  if (before && (before.kind === "expense" || before.kind === "income")) {
    const category = getAllCategories(workspaceId).find(
      (c) => c.id === body.categoryId
    );
    if (category && (category.kind === "expense" || category.kind === "income")) {
      recordMerchantCategory(
        workspaceId,
        before.description,
        body.categoryId,
        category.kind,
        "user"
      );

      // If the user just overrode an AI-set category, log it as a correction
      // so the categorizer learns not to repeat the mistake on similar merchants.
      if (
        before.categorySource === "ai" &&
        before.categoryId != null &&
        before.categoryId !== body.categoryId
      ) {
        recordCorrection(
          workspaceId,
          before.description,
          before.categoryId,
          body.categoryId,
          category.kind
        );
      }
    }
  }

  return NextResponse.json({
    success: true,
    applied,
    // Offer "apply to all" when other rows from this merchant still differ.
    sameMerchantCount: body.applyToMerchant ? 0 : sameMerchantTransactionIds(workspaceId, numericId, body.categoryId).length,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    approve?: unknown;
    displayName?: unknown;
    note?: unknown;
    applyNameToMerchant?: unknown;
  };

  const numericId = Number(id);

  // The user's name and note for the row. A name can then be given to the
  // merchant's other rows too, the way a category can.
  if ("displayName" in body || "note" in body) {
    const text = (v: unknown) => (typeof v === "string" ? v : v === null ? null : undefined);
    const displayName = text(body.displayName);
    const note = text(body.note);
    if (("displayName" in body && displayName === undefined) || ("note" in body && note === undefined)) {
      return NextResponse.json({ error: "displayName and note must be strings or null" }, { status: 400 });
    }
    if (setTransactionText(workspaceId, [numericId], { displayName, note }) === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const others = sameMerchantTransactionIds(workspaceId, numericId, undefined, true);
    let applied = 0;
    if (body.applyNameToMerchant === true && displayName !== undefined) {
      applied = setTransactionText(workspaceId, others, { displayName });
    }
    return NextResponse.json({
      success: true,
      applied,
      sameMerchantCount: body.applyNameToMerchant === true ? 0 : others.length,
    });
  }

  if (body.approve === true) {
    const ctx = getTransactionContext(workspaceId, numericId);
    if (!ctx) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    setTransactionNeedsReview(workspaceId, numericId, false);
    if (
      ctx.categoryId != null &&
      (ctx.kind === "expense" || ctx.kind === "income")
    ) {
      const category = getAllCategories(workspaceId).find(
        (c) => c.id === ctx.categoryId
      );
      if (
        category &&
        (category.kind === "expense" || category.kind === "income")
      ) {
        recordMerchantCategory(
          workspaceId,
          ctx.description,
          ctx.categoryId,
          category.kind,
          "approved-ai"
        );
      }
    }
    return NextResponse.json({ success: true });
  }

  if (
    body.kind !== "expense" &&
    body.kind !== "income" &&
    body.kind !== "transfer"
  ) {
    return NextResponse.json(
      { error: "kind must be 'expense', 'income', or 'transfer', or set approve:true" },
      { status: 400 }
    );
  }

  setTransactionKind(workspaceId, numericId, body.kind);

  return NextResponse.json({ success: true });
}
