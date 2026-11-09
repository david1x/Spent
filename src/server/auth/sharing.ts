import "server-only";

import crypto from "crypto";
import { getDb } from "../db/index";
import { AuthError, findUsableInvite, hashInviteToken, isAuthEnabled, ownerName, parseIds } from "./index";

/**
 * The owner sharing workspaces with other people. An invite is a single-use
 * link; whoever opens it picks their own name, password and authenticator
 * (see beginViewerEnrollment) and becomes a viewer of the invite's workspaces.
 * Viewers can look, and suggest a category, nothing else.
 */

export const INVITE_DAYS = 7;
const MAX_LABEL = 60;

export interface ShareInvite {
  id: number;
  label: string | null;
  workspaceIds: number[];
  createdAt: string;
  expiresAt: string;
}

export interface Viewer {
  id: number;
  username: string;
  createdAt: string;
  workspaceIds: number[];
  /** Most recent activity in any of their browsers, if any is signed in. */
  lastSeenAt: string | null;
  activeSessions: number;
}

function existingWorkspaceIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  const wanted = [...new Set(ids.filter((n): n is number => Number.isInteger(n) && n > 0))];
  if (wanted.length === 0) return [];
  const rows = getDb()
    .prepare(`SELECT id FROM workspaces WHERE id IN (${wanted.map(() => "?").join(",")}) ORDER BY id`)
    .all(...wanted) as { id: number }[];
  return rows.map((r) => r.id);
}

function assertSharingAvailable(): void {
  if (!isAuthEnabled()) {
    throw new AuthError("not_enabled", "Turn on sign-in first, so Spent can tell people apart.", 409);
  }
}

export function createInvite(
  workspaceIds: unknown,
  label: unknown
): { invite: ShareInvite; token: string } {
  assertSharingAvailable();
  const ids = existingWorkspaceIds(workspaceIds);
  if (ids.length === 0) throw new AuthError("invalid_request", "Choose at least one workspace to share.");
  const name = typeof label === "string" ? label.trim().slice(0, MAX_LABEL) || null : null;
  const token = crypto.randomBytes(24).toString("base64url");
  const db = getDb();
  const id = Number(
    db
      .prepare(
        `INSERT INTO share_invites (token_hash, workspace_ids, label, expires_at)
         VALUES (?, ?, ?, datetime('now', ?))`
      )
      .run(hashInviteToken(token), JSON.stringify(ids), name, `+${INVITE_DAYS} days`).lastInsertRowid
  );
  const invite = listInvites().find((i) => i.id === id);
  if (!invite) throw new Error("invite not saved");
  return { invite, token };
}

/** Links not used yet and not expired. */
export function listInvites(): ShareInvite[] {
  const rows = getDb()
    .prepare(
      `SELECT id, label, workspace_ids, created_at, expires_at FROM share_invites
       WHERE used_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC`
    )
    .all() as { id: number; label: string | null; workspace_ids: string; created_at: string; expires_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    workspaceIds: parseIds(r.workspace_ids),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

export function revokeInvite(id: number): boolean {
  return getDb().prepare("DELETE FROM share_invites WHERE id = ? AND used_at IS NULL").run(id).changes > 0;
}

/** What the invite page may show before anyone signs in. */
export function describeInvite(token: string): { ownerName: string | null; workspaces: string[]; expiresAt: string } | null {
  const invite = findUsableInvite(token);
  if (!invite) return null;
  const ids = parseIds(invite.workspace_ids);
  const db = getDb();
  const names = ids.length
    ? (
        db
          .prepare(`SELECT name FROM workspaces WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`)
          .all(...ids) as { name: string }[]
      ).map((r) => r.name)
    : [];
  const { expires_at } = db.prepare("SELECT expires_at FROM share_invites WHERE id = ?").get(invite.id) as {
    expires_at: string;
  };
  return { ownerName: ownerName(), workspaces: names, expiresAt: expires_at };
}

export function listViewers(): Viewer[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.id, v.username, v.created_at,
              (SELECT MAX(last_seen_at) FROM auth_sessions s
                WHERE s.viewer_id = v.id AND s.expires_at > datetime('now')) AS last_seen_at,
              (SELECT COUNT(*) FROM auth_sessions s
                WHERE s.viewer_id = v.id AND s.expires_at > datetime('now')) AS active_sessions
       FROM viewers v ORDER BY v.created_at`
    )
    .all() as { id: number; username: string; created_at: string; last_seen_at: string | null; active_sessions: number }[];
  const shares = db.prepare("SELECT viewer_id, workspace_id FROM viewer_workspaces ORDER BY workspace_id").all() as {
    viewer_id: number;
    workspace_id: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    activeSessions: r.active_sessions,
    workspaceIds: shares.filter((s) => s.viewer_id === r.id).map((s) => s.workspace_id),
  }));
}

/**
 * Replaces the workspaces a viewer sees. An empty list is allowed: they can
 * still sign in, but there's nothing to show until something is shared again.
 */
export function setViewerWorkspaces(viewerId: number, workspaceIds: unknown): number[] | null {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM viewers WHERE id = ?").get(viewerId)) return null;
  const ids = existingWorkspaceIds(workspaceIds);
  db.transaction(() => {
    db.prepare("DELETE FROM viewer_workspaces WHERE viewer_id = ?").run(viewerId);
    const add = db.prepare("INSERT INTO viewer_workspaces (viewer_id, workspace_id) VALUES (?, ?)");
    for (const id of ids) add.run(viewerId, id);
  })();
  return ids;
}

/** Removes the person, their sign-in and every browser they're signed in on. */
export function removeViewer(viewerId: number): boolean {
  return getDb().prepare("DELETE FROM viewers WHERE id = ?").run(viewerId).changes > 0;
}

/** Signs a viewer out everywhere without removing them. */
export function endViewerSessions(viewerId: number): number {
  return getDb().prepare("DELETE FROM auth_sessions WHERE viewer_id = ?").run(viewerId).changes;
}
