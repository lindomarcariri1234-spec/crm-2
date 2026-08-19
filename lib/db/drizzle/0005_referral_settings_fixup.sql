-- Backfill discount_expiration_days from expiration_days for all existing rows
UPDATE "referral_settings"
SET "discount_expiration_days" = "expiration_days"
WHERE "discount_expiration_days" = 30;

-- Fix min_purchase_amount: default 0, make NOT NULL
ALTER TABLE "referral_settings"
  ALTER COLUMN "min_purchase_amount" SET DEFAULT 0;

UPDATE "referral_settings"
SET "min_purchase_amount" = 0
WHERE "min_purchase_amount" IS NULL;

ALTER TABLE "referral_settings"
  ALTER COLUMN "min_purchase_amount" SET NOT NULL;

-- Add CHECK constraint on referral_code_status for valid enum values
DO $$
BEGIN
  ALTER TABLE "clients"
    ADD CONSTRAINT "clients_referral_code_status_check"
    CHECK ("referral_code_status" IN ('active', 'blocked', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Clamp any stale out-of-range values to 'active' before constraint applies
UPDATE "clients"
SET "referral_code_status" = 'active'
WHERE "referral_code_status" NOT IN ('active', 'blocked', 'cancelled');
