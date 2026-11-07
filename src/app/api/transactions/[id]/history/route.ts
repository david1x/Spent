import { NextResponse } from "next/server";
import { getTransactionHistory } from "@/server/db/queries/transactions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

/** Installment plan and merchant history behind the payment history sheet. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid transaction id" }, { status: 400 });
  }
  // The scope only decides which rows count as spending; the history itself
  // covers every account in the workspace.
  return withRequestScope(request, workspaceId, () => {
    const history = getTransactionHistory(workspaceId, id);
    if (!history) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json(history);
  });
}
