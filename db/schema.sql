-- Schema SQLite/libSQL oficial do BioMatch (Turso).
-- Mantido neste caminho por compatibilidade com documentação anterior.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 2 AND 18),
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
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(requester_id, addressee_id),
  CHECK(requester_id <> addressee_id)
);
CREATE TABLE IF NOT EXISTS direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 240),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenger_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenged_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(challenger_id <> challenged_id)
);
CREATE INDEX IF NOT EXISTS idx_challenges_users ON challenges(challenger_id, challenged_id, created_at DESC);
