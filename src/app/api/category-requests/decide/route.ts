import { NextResponse, type NextRequest } from "next/server";
import { decideCategoryRequests } from "@/server/db/queries/category-requests";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { NO_STORE, ownerOnly, readJson } from "@/server/auth/http";

export const dynamic = "force-dynamic";

/** The owner approves or declines `{ ids, decision }`. */
export async function POST(request: NextRequest) {
  const denied = ownerOnly(request);
  if (denied) return denied;
  const body = await readJson(request);
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
  if (ids.length === 0 || (body.decision !== "approve" && body.decision !== "decline")) {
    return NextResponse.json({ message: "Send ids and a decision." }, { status: 400 });
  }
  const result = decideCategoryRequests(getWorkspaceIdFromRequest(request), ids, body.decision);
  return NextResponse.json(result, { headers: NO_STORE });
}
