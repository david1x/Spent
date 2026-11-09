import { NextResponse } from "next/server";
import {
  setTransactionKind,
  setTransactionNeedsReview,
  getTransactionContext,
  setTransactionText,
} from "@/server/db/queries/transactions";
import { recordMerchantCategory, sameMerchantTransactionIds } from "@/server/lib/merchant-memory";
import { applyCategoryChange } from "@/server/lib/category-change";
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

  const result = applyCategoryChange(workspaceId, Number(id), body.categoryId, body.applyToMerchant === true);
  return NextResponse.json({
    success: true,
    applied: result.applied,
    // Offer "apply to all" when other rows from this merchant still differ.
    sameMerchantCount: result.sameMerchantCount,
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
