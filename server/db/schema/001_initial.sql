-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Initial database schema for Emo

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email_enc BLOB NOT NULL,
  email_hmac BLOB NOT NULL UNIQUE,
  tz TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  wake_start TEXT NOT NULL DEFAULT '09:00',
  wake_end TEXT NOT NULL DEFAULT '22:00',
  reminders_per_day INTEGER NOT NULL DEFAULT 3,
  min_gap_min INTEGER NOT NULL DEFAULT 120,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keyrings (
  account_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  kdf_json TEXT NOT NULL,
  dek_wrapped_pass BLOB NOT NULL,
  dek_wrapped_recovery BLOB NOT NULL,
  auth_hash BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, key_version, rev)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS gone_sessions (
  token_hash TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  code_enc BLOB,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);

CREATE TABLE IF NOT EXISTS invite_uses (
  code_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (code_hash, account_id)
);
CREATE INDEX IF NOT EXISTS idx_invite_uses_code ON invite_uses(code_hash);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  email_hmac BLOB NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  invite_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_expires ON login_codes(expires_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subs_account ON push_subscriptions(account_id);

CREATE TABLE IF NOT EXISTS prefs (
  account_id TEXT PRIMARY KEY,
  key_version INTEGER NOT NULL,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  nonce BLOB,
  ciphertext BLOB,
  deleted INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  PRIMARY KEY (account_id, id),
  UNIQUE (account_id, seq),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  tz TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reminders_status_sched ON reminders(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_reminders_account_date ON reminders(account_id, local_date);
CREATE INDEX IF NOT EXISTS idx_reminders_account_updated ON reminders(account_id, updated_at);

CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL
);
