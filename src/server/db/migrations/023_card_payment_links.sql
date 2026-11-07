-- One card login (e.g. a Visa Cal user) can hold several cards, and each card
-- can be billed to a different bank account. Links therefore live per card
-- (credential + card account number), replacing the per-login
-- bank_credentials.paid_from_credential_id added in 022.
--
-- Security: ids and card last digits only, never credential material.

CREATE TABLE card_payment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  card_credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  card_account_number TEXT NOT NULL,
  bank_credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, card_credential_id, card_account_number)
);

CREATE INDEX idx_card_payment_links_card
  ON card_payment_links(workspace_id, card_credential_id);

-- Carry any login-level link over to every card seen under that login.
INSERT INTO card_payment_links
  (workspace_id, card_credential_id, card_account_number, bank_credential_id)
SELECT DISTINCT bc.workspace_id, bc.id, t.account_number, bc.paid_from_credential_id
FROM bank_credentials bc
JOIN transactions t ON t.credential_id = bc.id
WHERE bc.paid_from_credential_id IS NOT NULL;

-- Superseded by card_payment_links. SQLite can't drop a column that carries a
-- REFERENCES clause, so it stays, always NULL.
UPDATE bank_credentials SET paid_from_credential_id = NULL;

-- Which card(s) a matched bank debit settled, comma separated. More than one
-- when a single debit paid several cards from the same login.
ALTER TABLE transactions ADD COLUMN card_bill_accounts TEXT;
