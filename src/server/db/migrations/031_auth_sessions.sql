-- Signed-in browsers, for the optional sign-in (Settings, Security). Only a
-- SHA-256 of each session token is stored, so a copy of the database can't
-- be used to sign in. The account itself (name, password hash, authenticator
-- secret, recovery codes) lives in `settings` under auth_* keys.
CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
