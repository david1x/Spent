import "server-only";

import { getDb } from "../index";

/** A card the card company lists under a login (migration 030). */
export interface LoginCardRow {
  accountNumber: string;
  label: string | null;
  active: boolean;
  syncEnabled: boolean;
  discoveredAt: string;
  lastSeenAt: string;
}

export interface SeenCard {
  accountNumber: string;
  label?: string | null;
  /** Undefined when the source doesn't say (a plain sync of an older scraper). */
  active?: boolean;
}

/** Records cards the bank reported. New ones start included in syncs. */
export function recordSeenCards(credentialId: number, cards: SeenCard[]): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO login_cards (credential_id, account_number, label, active)
     VALUES (@credentialId, @accountNumber, @label, COALESCE(@active, 1))
     ON CONFLICT(credential_id, account_number) DO UPDATE SET
       label = COALESCE(excluded.label, login_cards.label),
       active = COALESCE(@active, login_cards.active),
       last_seen_at = datetime('now')`
  );
  db.transaction(() => {
    for (const c of cards) {
      upsert.run({
        credentialId,
        accountNumber: c.accountNumber,
        label: c.label ?? null,
        active: c.active === undefined ? null : c.active ? 1 : 0,
      });
    }
  })();
}

export function listLoginCards(credentialId: number): LoginCardRow[] {
  const rows = getDb()
    .prepare(
      `SELECT account_number AS accountNumber, label, active, sync_enabled AS syncEnabled,
              discovered_at AS discoveredAt, last_seen_at AS lastSeenAt
       FROM login_cards WHERE credential_id = ?
       ORDER BY active DESC, account_number`
    )
    .all(credentialId) as Array<Omit<LoginCardRow, "active" | "syncEnabled"> & { active: number; syncEnabled: number }>;
  return rows.map((r) => ({ ...r, active: r.active === 1, syncEnabled: r.syncEnabled === 1 }));
}

/** Returns false when the login has no such card. */
export function setLoginCardSyncEnabled(credentialId: number, accountNumber: string, enabled: boolean): boolean {
  return (
    getDb()
      .prepare(
        "UPDATE login_cards SET sync_enabled = ? WHERE credential_id = ? AND account_number = ?"
      )
      .run(enabled ? 1 : 0, credentialId, accountNumber).changes > 0
  );
}

/** Cards the user left out of syncs. */
export function excludedCards(credentialId: number): string[] {
  return (
    getDb()
      .prepare(
        "SELECT account_number AS a FROM login_cards WHERE credential_id = ? AND sync_enabled = 0"
      )
      .all(credentialId) as { a: string }[]
  ).map((r) => r.a);
}
