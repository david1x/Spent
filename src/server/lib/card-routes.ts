import "server-only";

import { getDb } from "../db/index";

/**
 * Per-card workspace routing (migration 024). A card normally lives in its
 * login's workspace; a route sends it, and every future sync of it, to
 * another one.
 */

/** Account number to workspace id, for the cards of one login that are routed. */
export function getCardRouteMap(credentialId: number): Map<string, number> {
  const rows = getDb()
    .prepare(
      "SELECT account_number AS account, workspace_id AS workspaceId FROM card_workspace_routes WHERE credential_id = ?"
    )
    .all(credentialId) as { account: string; workspaceId: number }[];
  return new Map(rows.map((r) => [r.account, r.workspaceId]));
}

export interface LoginHome {
  provider: string;
  label: string;
  workspaceId: number;
}

/** A login's own workspace, whichever workspace is asking. */
export function getLoginHome(credentialId: number): LoginHome | null {
  return (
    (getDb()
      .prepare(
        "SELECT provider, label, workspace_id AS workspaceId FROM bank_credentials WHERE id = ?"
      )
      .get(credentialId) as LoginHome | undefined) ?? null
  );
}

/** Where a card's transactions live now: its route, else its login's workspace. */
export function getCardWorkspace(credentialId: number, accountNumber: string): number | null {
  const home = getLoginHome(credentialId);
  if (!home) return null;
  return getCardRouteMap(credentialId).get(accountNumber) ?? home.workspaceId;
}

/** Cards of other workspaces' logins that were moved into this one. */
export function listRoutedIn(workspaceId: number): { credentialId: number; accountNumber: string }[] {
  return getDb()
    .prepare(
      `SELECT r.credential_id AS credentialId, r.account_number AS accountNumber
       FROM card_workspace_routes r
       JOIN bank_credentials bc ON bc.id = r.credential_id
       WHERE r.workspace_id = ? AND bc.workspace_id <> r.workspace_id
       ORDER BY r.credential_id, r.account_number`
    )
    .all(workspaceId) as { credentialId: number; accountNumber: string }[];
}

/** Cards of this login that were moved out to other workspaces. */
export function listRoutedOut(
  credentialId: number
): { accountNumber: string; workspaceId: number; workspaceName: string }[] {
  return getDb()
    .prepare(
      `SELECT r.account_number AS accountNumber, r.workspace_id AS workspaceId, w.name AS workspaceName
       FROM card_workspace_routes r
       JOIN bank_credentials bc ON bc.id = r.credential_id
       JOIN workspaces w ON w.id = r.workspace_id
       WHERE r.credential_id = ? AND r.workspace_id <> bc.workspace_id
       ORDER BY r.account_number`
    )
    .all(credentialId) as { accountNumber: string; workspaceId: number; workspaceName: string }[];
}

/** Routes a card to a workspace, or back to its login's workspace. */
export function setCardRoute(credentialId: number, accountNumber: string, workspaceId: number): void {
  const db = getDb();
  const home = getLoginHome(credentialId);
  if (home && home.workspaceId === workspaceId) {
    db.prepare(
      "DELETE FROM card_workspace_routes WHERE credential_id = ? AND account_number = ?"
    ).run(credentialId, accountNumber);
    return;
  }
  db.prepare(
    `INSERT INTO card_workspace_routes (credential_id, account_number, workspace_id)
     VALUES (?, ?, ?)
     ON CONFLICT(credential_id, account_number) DO UPDATE SET workspace_id = excluded.workspace_id`
  ).run(credentialId, accountNumber, workspaceId);
}
