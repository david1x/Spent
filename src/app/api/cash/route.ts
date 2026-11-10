import { NextResponse } from "next/server";
import { buildCashStatus } from "@/server/insights/cash";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

/** Home's cash view: bank balances now, and what's still due before the period ends. */
export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return withRequestScope(request, workspaceId, () => NextResponse.json(buildCashStatus(workspaceId)));
}
