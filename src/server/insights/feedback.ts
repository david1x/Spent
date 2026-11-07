import "server-only";

import { getDb } from "../db";

export type FeedbackAction = "dismissed" | "snoozed" | "not_recurring" | "not_unusual";

export interface FeedbackState {
  /** Insight ids hidden right now (dismissed, or snoozed until later). */
  hidden: Set<string>;
  /** Series keys marked "not recurring". */
  notRecurring: Set<string>;
  /** Category or transaction keys marked "not unusual". */
  notUnusual: Set<string>;
}

export function loadFeedback(workspaceId: number, now = new Date()): FeedbackState {
  const rows = getDb()
    .prepare("SELECT key, action, until FROM insight_feedback WHERE workspace_id = ?")
    .all(workspaceId) as Array<{ key: string; action: FeedbackAction; until: string | null }>;
  const state: FeedbackState = { hidden: new Set(), notRecurring: new Set(), notUnusual: new Set() };
  const iso = now.toISOString();
  for (const r of rows) {
    if (r.action === "dismissed") state.hidden.add(r.key);
    else if (r.action === "snoozed" && r.until && r.until > iso) state.hidden.add(r.key);
    else if (r.action === "not_recurring") state.notRecurring.add(r.key);
    else if (r.action === "not_unusual") state.notUnusual.add(r.key);
  }
  return state;
}

export function saveFeedback(workspaceId: number, key: string, action: FeedbackAction, snoozeDays?: number): void {
  const until =
    action === "snoozed" ? new Date(Date.now() + Math.max(1, snoozeDays ?? 7) * 86_400_000).toISOString() : null;
  getDb()
    .prepare(
      `INSERT INTO insight_feedback (workspace_id, key, action, until) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET action = excluded.action, until = excluded.until, created_at = datetime('now')`
    )
    .run(workspaceId, key, action, until);
}

/** Brings back dismissed and snoozed insights. Detection feedback stays. */
export function resetHidden(workspaceId: number): number {
  return getDb()
    .prepare("DELETE FROM insight_feedback WHERE workspace_id = ? AND action IN ('dismissed', 'snoozed')")
    .run(workspaceId).changes;
}

/** Undoes one piece of feedback (e.g. "this is recurring after all"). */
export function clearFeedback(workspaceId: number, key: string): void {
  getDb().prepare("DELETE FROM insight_feedback WHERE workspace_id = ? AND key = ?").run(workspaceId, key);
}
