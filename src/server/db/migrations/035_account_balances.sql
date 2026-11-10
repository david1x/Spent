-- The balance each bank account reported on its latest sync, for the cash
-- view on Home: what's in the bank now, and what's still due before the end
-- of the period. One row per account; a sync replaces it.
CREATE TABLE account_balances (
  credential_id INTEGER NOT NULL REFERENCES bank_credentials(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  -- In the account's own currency.
  balance REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  -- Deposits and savings plans: shown, but not money to spend.
  savings INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (credential_id, account_number)
);

-- Rows the importer now recognizes as moving money rather than spending it
-- (see src/server/lib/transfers.ts): Leumi's card debit on its foreign
-- currency accounts ("ל.מסטרקארד"), and buying or selling foreign currency
-- between a bank's own accounts ("המרת קנ במטח").
UPDATE transactions
SET kind = 'transfer', updated_at = datetime('now')
WHERE kind != 'transfer'
  AND provider IN ('hapoalim', 'leumi', 'mizrahi', 'discount', 'mercantile', 'beinleumi',
                   'otsarHahayal', 'pagi', 'yahav', 'massad', 'union', 'oneZero')
  AND (description LIKE '%מסטרקארד%'
       OR (description LIKE '%המרת %' AND (description LIKE '%מטח%' OR description LIKE '%מט"ח%')));
