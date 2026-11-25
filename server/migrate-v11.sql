-- One-time move to version 11 (run once, before deploying the v11 server):
--   npx wrangler d1 execute daily-checklist --remote --file migrate-v11.sql
ALTER TABLE people ADD COLUMN last_water TEXT;
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  created INTEGER NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0
);
