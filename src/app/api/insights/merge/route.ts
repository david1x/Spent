import { NextResponse } from "next/server";
import { addMerchantAlias } from "@/server/insights/merchant";
import { saveFeedback } from "@/server/insights/feedback";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

/**
 * Merges two merchant names for the insight engine ({ alias, canonical } are
 * normalized keys from a merge suggestion), or { dismiss: true } to stop
 * suggesting the pair.
 */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => null)) as {
    alias?: unknown;
    canonical?: unknown;
    dismiss?: unknown;
  } | null;
  const alias = typeof body?.alias === "string" ? body.alias.slice(0, 200) : "";
  const canonical = typeof body?.canonical === "string" ? body.canonical.slice(0, 200) : "";
  if (!alias || !canonical || alias === canonical) {
    return NextResponse.json({ error: "Two different merchant keys are required" }, { status: 400 });
  }
  const pairId = `merge:${[alias, canonical].sort().join("|")}`;
  if (body?.dismiss === true) saveFeedback(workspaceId, pairId, "dismissed");
  else addMerchantAlias(workspaceId, alias, canonical);
  return NextResponse.json({ success: true });
}
