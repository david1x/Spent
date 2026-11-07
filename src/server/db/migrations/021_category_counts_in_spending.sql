-- Categories that only move money around (transfers between your own
-- accounts, Bit/PayBox moves) inflate spending totals when counted. This flag
-- lets a category stay visible in lists while being left out of spending and
-- income totals. Transfers starts out not counted; users can flip it per
-- category in Settings > Categories.

ALTER TABLE categories
  ADD COLUMN counts_in_spending INTEGER NOT NULL DEFAULT 1;

UPDATE categories
  SET counts_in_spending = 0
  WHERE name = 'Transfers';
