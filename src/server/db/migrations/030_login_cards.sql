-- The cards under a card login, as the card company lists them. Filled by a
-- quick card check (sign in, read the card list, no transactions) and by
-- every sync, so a card shows up even before it has transactions.
--
-- `sync_enabled` = 0 leaves the card out of syncs; new cards start included
-- so nothing is missed silently. `active` = 0 for cancelled cards, which can
-- still carry standing charges.
CREATE TABLE login_cards (
  credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (credential_id, account_number)
) WITHOUT ROWID;
