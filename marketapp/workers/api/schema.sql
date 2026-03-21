-- WoW Market Tracker - D1 Schema
-- Apply with: wrangler d1 execute wow-market-db --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  description   TEXT,
  filters       TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_run_at   INTEGER,
  last_run_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key      TEXT    NOT NULL,
  realm_id      INTEGER NOT NULL,
  noted_price   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(user_id, item_key)
);

CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  realm_id      INTEGER NOT NULL,
  generated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  summary       TEXT    NOT NULL DEFAULT '{}',
  items         TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS realm_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  realm_name    TEXT    NOT NULL,
  region        TEXT    NOT NULL,
  reason        TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  reviewed_at   INTEGER,
  reviewed_by   INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_user    ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user   ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user     ON reports(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_realm_requests_status ON realm_requests(status, created_at DESC);

-- Seed admin user (password: changeme — SHA256 of "changeme" + user_id=1)
-- Replace password_hash with: SHA256("yourpassword" + "1") encoded as base64
-- Use: wrangler d1 execute wow-market-db --command "INSERT INTO users ..."
