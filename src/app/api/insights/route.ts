import { NextResponse } from "next/server";
import { buildInsights } from "@/server/insights";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";

/** The Insights page: forecast, recurring charges, the ranked feed and more. */
export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return withRequestScope(request, workspaceId, () => NextResponse.json(buildInsights(workspaceId)));
}
