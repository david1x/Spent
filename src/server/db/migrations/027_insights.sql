-- Insights page (src/server/insights).
--
-- insight_feedback: what the user did with an insight. `key` is the insight's
-- stable id ("price_up:<series>:<date>") or, for detection-level feedback,
-- a series or category key ("series:<key>"). Snoozes carry `until`.
CREATE TABLE insight_feedback (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismissed', 'snoozed', 'not_recurring', 'not_unusual')),
  until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, key)
) WITHOUT ROWID;

-- merchant_aliases: the user merged two merchant names ("019 Telzar" cut to
-- 20 characters by one card and spelled out by another). Both are keys from
-- normalizeMerchant().
CREATE TABLE merchant_aliases (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  canonical TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, alias)
) WITHOUT ROWID;
