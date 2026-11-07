import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { buildInsights } from "@/server/insights";
import { buildMerchantKeys } from "@/server/insights/merchant";
import { updateOverride } from "@/server/insights/overrides";
import { clearFeedback } from "@/server/insights/feedback";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { withRequestScope } from "@/server/lib/scope";
import { toLocalISODate } from "@/server/lib/date-utils";
import type { RecurringCadence } from "@/lib/insights-types";

const CADENCES = new Set<RecurringCadence>(["weekly", "monthly", "bimonthly", "quarterly", "annual"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Target {
  key: string;
  merchantKey: string;
  direction: "out" | "in";
}

function parseTarget(body: Record<string, unknown>): Target | null {
  const { key, merchantKey, direction } = body;
  if (typeof key !== "string" || typeof merchantKey !== "string") return null;
  if (direction !== "out" && direction !== "in") return null;
  if (!key.startsWith(`${merchantKey}|${direction}`) || key.length > 300) return null;
  return { key, merchantKey, direction };
}

/**
 * The user's say on a recurring charge:
 * - { action: "cadence", key, merchantKey, direction, cadence } ("auto" hands it back to detection)
 * - { action: "cancel", key, merchantKey, direction, cancelled, date? }
 * - { action: "track", transactionId, cadence } tracks a transaction's merchant as a subscription
 */
export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  if (body.action === "cadence" || body.action === "cancel") {
    const target = parseTarget(body);
    if (!target) return NextResponse.json({ error: "Unknown recurring charge" }, { status: 400 });
    if (body.action === "cadence") {
      const cadence = body.cadence === "auto" ? null : (body.cadence as RecurringCadence);
      if (cadence !== null && !CADENCES.has(cadence)) {
        return NextResponse.json({ error: "Unknown frequency" }, { status: 400 });
      }
      updateOverride(workspaceId, target, { cadence });
    } else {
      const date = typeof body.date === "string" && DAY.test(body.date) ? body.date : toLocalISODate(new Date());
      updateOverride(workspaceId, target, { cancelledAt: body.cancelled === true ? date : null });
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === "track") {
    const id = Number(body.transactionId);
    const cadence = body.cadence as RecurringCadence;
    if (!Number.isInteger(id) || id <= 0 || !CADENCES.has(cadence)) {
      return NextResponse.json({ error: "transactionId and a frequency are required" }, { status: 400 });
    }
    const db = getDb();
    const txn = db
      .prepare("SELECT description, charged_amount FROM transactions WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, id) as { description: string; charged_amount: number } | undefined;
    if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    // Same keys the engine uses, so a cut-off name joins its full one.
    const descriptions = (db.prepare("SELECT DISTINCT description FROM transactions WHERE workspace_id = ?").all(workspaceId) as Array<{
      description: string;
    }>).map((r) => r.description);
    const merchantKey = buildMerchantKeys(workspaceId, descriptions).get(txn.description) ?? txn.description;
    const direction = txn.charged_amount < 0 ? "out" : "in";

    // Already detected: set its frequency instead of adding a second copy.
    const existing = withRequestScope(request, workspaceId, () => buildInsights(workspaceId)).recurring
      .filter((s) => s.merchantKey === merchantKey && (s.direction === "expense") === (direction === "out"))
      .sort((a, b) => Math.abs(a.typical - Math.abs(txn.charged_amount)) - Math.abs(b.typical - Math.abs(txn.charged_amount)))[0];
    const target = existing
      ? { key: existing.key, merchantKey, direction }
      : { key: `${merchantKey}|${direction}`, merchantKey, direction };
    clearFeedback(workspaceId, target.key);
    updateOverride(workspaceId, target as Target, { cadence, manual: !existing, cancelledAt: null });
    return NextResponse.json({ success: true, key: target.key });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
