-- What the user told the Insights page about a recurring charge: how often
-- it bills (overrides detection), that it was canceled (so it stops being
-- expected), or that it should be tracked even though detection never found
-- it (a yearly subscription seen once). `series_key` is RecurringSeries.key.
CREATE TABLE recurring_overrides (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  merchant_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  cadence TEXT CHECK (cadence IN ('weekly', 'monthly', 'bimonthly', 'quarterly', 'annual')),
  cancelled_at TEXT,
  manual INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, series_key)
) WITHOUT ROWID;
