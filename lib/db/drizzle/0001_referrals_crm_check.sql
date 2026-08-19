-- Corrective migration: restore the `referrals_crm_requires_reservation_id`
-- CHECK constraint that the consolidated baseline (0000_squash_baseline) omits.
--
-- The constraint was originally added by the legacy manual migration 0071. It is
-- NOT represented in the Drizzle schema TS, so `drizzle-kit generate` did not
-- reproduce it when the baseline was generated from the schema. As a result a
-- brand-new database built from the baseline alone lacks this data-integrity
-- guard, while existing databases (which ran 0071) already have it.
--
-- This migration is idempotent: the DO block swallows duplicate_object so it is a
-- no-op on databases that already have the constraint, and adds it on fresh ones.
-- Its `when` in meta/_journal.json is set above every existing database's
-- migration watermark so it also runs (harmlessly) on already-migrated databases.
DO $$
BEGIN
  ALTER TABLE "referrals" ADD CONSTRAINT "referrals_crm_requires_reservation_id"
    CHECK (source IS DISTINCT FROM 'crm' OR reservation_id IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
