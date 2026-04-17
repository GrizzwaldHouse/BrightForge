-- schema.sql
-- Database schema for idea intelligence system

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  score REAL,
  tags TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS idx_ideas_score ON ideas(score DESC);
