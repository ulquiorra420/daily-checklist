-- One-time move to version 12 (run once, before deploying the v12 server):
--   npx wrangler d1 execute daily-checklist --remote --file migrate-v12.sql
ALTER TABLE plans ADD COLUMN last_slot INTEGER;
-- v11 marked a plan "sent" after its single reminder; today's still-unticked ones get their repeats from now on.
UPDATE plans SET sent = 0, last_slot = (CAST(substr(time, 1, 2) AS INTEGER) * 60 + CAST(substr(time, 4, 2) AS INTEGER)) WHERE sent = 1 AND date >= date('now', '-1 day');
