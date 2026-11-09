-- A payment that covers several months at once, like a year of dog food
-- paid up front. Budgets and spending totals count an equal part of it in
-- each month, starting with the month it was paid (see spend-view.ts). NULL
-- means it counts in full when paid, like any other transaction.
ALTER TABLE transactions ADD COLUMN spread_months INTEGER;
CREATE INDEX IF NOT EXISTS idx_transactions_spread ON transactions(workspace_id) WHERE spread_months IS NOT NULL;
