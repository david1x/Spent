import { NextResponse } from "next/server";
import {
  getAllBudgets,
  setBudget,
  deleteBudget,
} from "@/server/db/queries/budgets";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json(getAllBudgets(workspaceId));
}

export async function PUT(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as {
    categoryId: number;
    amount?: number | null;
  };

  if (!body.categoryId) {
    return NextResponse.json(
      { error: "categoryId is required" },
      { status: 400 }
    );
  }

  if (body.amount == null) {
    deleteBudget(workspaceId, body.categoryId);
    return NextResponse.json({ success: true });
  }

  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
    return NextResponse.json(
      { error: "amount must be a non-negative number" },
      { status: 400 }
    );
  }

  // Exact to the agora, without float noise like 1234.5600000001.
  setBudget(workspaceId, body.categoryId, Math.round(body.amount * 100) / 100, false);
  return NextResponse.json({ success: true });
}
