-- Sharing: the owner (the account in Settings, Security) can invite other
-- people to see chosen workspaces. They get their own sign-in (password plus
-- authenticator), can't change anything, and can only suggest a different
-- category for a transaction, which waits for the owner's approval.

CREATE TABLE viewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  -- Encrypted with the app key, the same way as the owner's secret.
  totp_secret TEXT NOT NULL,
  totp_last_step INTEGER NOT NULL DEFAULT -1,
  -- JSON array of SHA-256 hashes of the unused recovery codes.
  recovery_codes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE viewer_workspaces (
  viewer_id INTEGER NOT NULL REFERENCES viewers(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (viewer_id, workspace_id)
);

-- NULL is the owner; otherwise the viewer this browser is signed in as.
ALTER TABLE auth_sessions ADD COLUMN viewer_id INTEGER REFERENCES viewers(id) ON DELETE CASCADE;

-- Single-use invite links. Only a hash of the link's token is stored.
CREATE TABLE share_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  -- JSON array of workspace ids the new viewer will see.
  workspace_ids TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  viewer_id INTEGER REFERENCES viewers(id) ON DELETE SET NULL
);

CREATE TABLE category_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  viewer_id INTEGER REFERENCES viewers(id) ON DELETE SET NULL,
  -- Kept so the request still says who asked after that person is removed.
  requested_by TEXT NOT NULL,
  from_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  to_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE INDEX idx_category_requests_workspace ON category_requests(workspace_id, status);
-- One open suggestion per transaction; a new one replaces it.
CREATE UNIQUE INDEX idx_category_requests_pending ON category_requests(transaction_id) WHERE status = 'pending';
