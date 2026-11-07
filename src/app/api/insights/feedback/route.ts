import { NextResponse } from "next/server";
import { clearFeedback, resetHidden, saveFeedback, type FeedbackAction } from "@/server/insights/feedback";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

const ACTIONS = new Set<FeedbackAction>(["dismissed", "snoozed", "not_recurring", "not_unusual"]);

/**
 * { key, action, days? } records feedback on an insight; action "reset"
 * brings back everything dismissed or snoozed, and "clear" undoes one key.
 */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
    action?: unknown;
    days?: unknown;
  } | null;
  if (body?.action === "reset") {
    return NextResponse.json({ restored: resetHidden(workspaceId) });
  }
  const key = typeof body?.key === "string" ? body.key.slice(0, 500) : "";
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  if (body?.action === "clear") {
    clearFeedback(workspaceId, key);
    return NextResponse.json({ success: true });
  }
  if (typeof body?.action !== "string" || !ACTIONS.has(body.action as FeedbackAction)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const days = typeof body.days === "number" && body.days > 0 && body.days <= 365 ? body.days : undefined;
  saveFeedback(workspaceId, key, body.action as FeedbackAction, days);
  return NextResponse.json({ success: true });
}
