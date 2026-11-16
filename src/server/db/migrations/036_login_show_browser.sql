-- Per-login choice to run the sync in a visible browser window instead of
-- headless. Independent of the 2FA flag, which also needs the window but
-- only for banks whose code Spent can't ask for itself.

ALTER TABLE bank_credentials
  ADD COLUMN show_browser INTEGER NOT NULL DEFAULT 0;
