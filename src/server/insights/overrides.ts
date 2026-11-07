import "server-only";

import { getDb } from "../db";
import type { RecurringCadence } from "@/lib/insights-types";
import type { RecurringOverride } from "./recurring";

export function loadOverrides(workspaceId: number): Map<string, RecurringOverride> {
  const rows = getDb()
    .prepare(
      `SELECT series_key, merchant_key, direction, cadence, cancelled_at, manual
       FROM recurring_overrides WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<{
    series_key: string;
    merchant_key: string;
    direction: "out" | "in";
    cadence: RecurringCadence | null;
    cancelled_at: string | null;
    manual: number;
  }>;
  return new Map(
    rows.map((r) => [
      r.series_key,
      {
        key: r.series_key,
        merchantKey: r.merchant_key,
        direction: r.direction,
        cadence: r.cadence,
        cancelledAt: r.cancelled_at,
        manual: r.manual === 1,
      },
    ])
  );
}

/**
 * Sets the given fields on a series' override, keeping the others. A row
 * left with nothing to say is removed, so detection takes over again.
 */
export function updateOverride(
  workspaceId: number,
  target: { key: string; merchantKey: string; direction: "out" | "in" },
  change: Partial<Pick<RecurringOverride, "cadence" | "cancelledAt" | "manual">>
): void {
  const current = loadOverrides(workspaceId).get(target.key);
  const next = {
    cadence: change.cadence !== undefined ? change.cadence : (current?.cadence ?? null),
    cancelledAt: change.cancelledAt !== undefined ? change.cancelledAt : (current?.cancelledAt ?? null),
    manual: change.manual !== undefined ? change.manual : (current?.manual ?? false),
  };
  const db = getDb();
  if (!next.cadence && !next.cancelledAt && !next.manual) {
    db.prepare("DELETE FROM recurring_overrides WHERE workspace_id = ? AND series_key = ?").run(workspaceId, target.key);
    return;
  }
  db.prepare(
    `INSERT INTO recurring_overrides (workspace_id, series_key, merchant_key, direction, cadence, cancelled_at, manual, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(workspace_id, series_key) DO UPDATE SET
       cadence = excluded.cadence,
       cancelled_at = excluded.cancelled_at,
       manual = excluded.manual,
       updated_at = excluded.updated_at`
  ).run(workspaceId, target.key, target.merchantKey, target.direction, next.cadence, next.cancelledAt, next.manual ? 1 : 0);
}
