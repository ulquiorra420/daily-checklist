-- One-time move to version 13 (run once, before deploying the v13 server):
--   npx wrangler d1 execute daily-checklist --remote --file migrate-v13.sql
ALTER TABLE plans ADD COLUMN by_id TEXT; -- who added it; NULL = the person themself (older plans)
