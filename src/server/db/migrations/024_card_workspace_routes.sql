-- One card under a card login can live in a different workspace than the
-- login itself (a shared login with a card that belongs to someone else's
-- budget). Synced transactions for that card are written to the routed
-- workspace. No row means the card lives with its login.
CREATE TABLE card_workspace_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(credential_id, account_number)
);
CREATE INDEX idx_card_workspace_routes_workspace ON card_workspace_routes(workspace_id);
