-- 0023: Add source column to referrals table in production.
--
-- Root cause confirmed in production logs (June 2026):
--   • column "source" does not exist → GET /api/clients/:id/referral → 500
--
-- The column exists in the Drizzle schema and squash baseline (0000) but was
-- never created in the production database via an incremental migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to re-run on any database.

--> statement-breakpoint

ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "source" text;
