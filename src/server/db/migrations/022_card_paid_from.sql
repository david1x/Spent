-- Link a credit card login to the bank login whose account pays its bill.
--
-- Israeli card statements are settled by one monthly debit on a bank account.
-- Counting both the itemized card purchases and that debit doubles spending.
-- With the link in place, the sync reconciler (src/server/lib/card-bills.ts)
-- finds the bank debit that equals each card billing cycle and marks it as a
-- transfer, remembering which card it settled in card_bill_credential_id so
-- the match can be undone when the link changes.
--
-- Security: these columns hold row ids only, never credential material.

ALTER TABLE bank_credentials
  ADD COLUMN paid_from_credential_id INTEGER
    REFERENCES bank_credentials(id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD COLUMN card_bill_credential_id INTEGER
    REFERENCES bank_credentials(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_card_bill
  ON transactions(workspace_id, card_bill_credential_id);

-- The transfer detector only knew the singular "כרטיס אשראי". Bank Hapoalim
-- writes the plural "כרטיסי אשראי", so those card bills were counted as
-- spending on top of the card's own purchases.
UPDATE transactions
  SET kind = 'transfer'
  WHERE kind = 'expense'
    AND charged_amount < 0
    AND description LIKE '%כרטיסי אשראי%'
    AND provider IN ('hapoalim', 'leumi', 'mizrahi', 'discount', 'mercantile',
                     'beinleumi', 'otsarHahayal', 'pagi', 'yahav', 'massad',
                     'union', 'oneZero');
