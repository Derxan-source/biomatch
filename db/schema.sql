-- Schema SQLite/libSQL oficial do BioMatch (Turso).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 18),
  email TEXT,
  password_hash TEXT,
  xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
  answers INTEGER NOT NULL DEFAULT 0 CHECK(answers >= 0),
  correct INTEGER NOT NULL DEFAULT 0 CHECK(correct >= 0 AND correct <= answers),
  streak INTEGER NOT NULL DEFAULT 0 CHECK(streak >= 0),
  badges_json TEXT NOT NULL DEFAULT '[]',
  subject_stats_json TEXT NOT NULL DEFAULT '{}',
  daily_date TEXT,
  daily_answers INTEGER NOT NULL DEFAULT 0 CHECK(daily_answers >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_users_display_name ON users(display_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS question_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  selected_option INTEGER NOT NULL CHECK(selected_option BETWEEN 0 AND 3),
  is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
  xp_earned INTEGER NOT NULL DEFAULT 0 CHECK(xp_earned >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON question_attempts(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS live_rooms (
  code TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hit_count INTEGER NOT NULL
);
