-- Catch-all corrective migration: adds every column that exists in the Drizzle
-- TypeScript schema but was absent from 0000_squash_baseline.sql.
--
-- Background: the squash baseline was generated from an incomplete snapshot.
-- Each affected column was individually covered by migrations 0002–0019, but
-- if ANY of those migrations was skipped (e.g. applied-watermark mismatch), the
-- column silently never appeared — causing 500 errors. This migration closes
-- the remaining gap.
--
-- Every statement is idempotent (ADD COLUMN IF NOT EXISTS / EXCEPTION WHEN
-- duplicate_object), so re-running on an up-to-date database is safe.

-- clients ─────────────────────────────────────────────────────────────────────
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "referral_code_status" text NOT NULL DEFAULT 'active';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "referral_suspended_attempt_at" timestamptz;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "referral_suspended_attempt_count" integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE "clients"
    ADD CONSTRAINT "clients_referral_code_status_check"
    CHECK ("referral_code_status" IN ('active', 'blocked', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- referral_settings ───────────────────────────────────────────────────────────
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "whatsapp_reversed_message" text;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "discount_expiration_days" integer NOT NULL DEFAULT 30;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "min_purchase_amount" numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "max_referrals_per_user" integer NOT NULL DEFAULT 0;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "grace_period_days" integer NOT NULL DEFAULT 30;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "bonus_validity_days" integer NOT NULL DEFAULT 30;

-- store_orders ────────────────────────────────────────────────────────────────
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "pending_referral" json;
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "pending_credit_spend" json;
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "referral_effects_applied_at" timestamp with time zone;

-- tenants ─────────────────────────────────────────────────────────────────────
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prefix_locked" boolean NOT NULL DEFAULT false;

-- referrals ───────────────────────────────────────────────────────────────────
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "reversal_reason" text;
ALTER TABLE "referrals" ADD COLUMN IF NOT EXISTS "reversal_at" timestamptz;
