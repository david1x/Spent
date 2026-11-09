-- A foreign purchase's shekel amount the user typed in (to match their card
-- bill). Syncs and exchange-rate refreshes leave it alone; charged_auto keeps
-- what the bank or the estimate said, so "use the automatic amount" can put
-- it back.
ALTER TABLE transactions ADD COLUMN charged_by_user INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN charged_auto REAL;
ALTER TABLE transactions ADD COLUMN charged_auto_estimated INTEGER;
