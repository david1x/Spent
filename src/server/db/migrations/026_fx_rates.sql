-- Daily Bank of Israel representative rates, shekels per unit of `currency`.
-- Seeded from src/server/data/fx-rates.json on startup and extended by
-- Settings > General > "Update rates". Used to estimate the shekel amount of
-- foreign purchases a card bills in their own currency (migration 025).
CREATE TABLE fx_rates (
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  PRIMARY KEY (currency, date)
) WITHOUT ROWID;
