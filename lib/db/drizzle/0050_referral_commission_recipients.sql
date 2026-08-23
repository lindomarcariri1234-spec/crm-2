-- Referral campaign commissions have a contractual recipient independent of
-- the promotional bonus recipient. Keep each column in its own statement so
-- schema coverage can validate upgrades against the fresh baseline.
ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "referral_commission_eligible" boolean DEFAULT false NOT NULL;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "commission_recipient_type" text DEFAULT 'ambassador' NOT NULL;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "eligible_partner_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "referral_commissions"
  ADD COLUMN IF NOT EXISTS "recipient_type" text DEFAULT 'ambassador' NOT NULL;

ALTER TABLE "referral_commissions"
  ADD COLUMN IF NOT EXISTS "recipient_id" text;

UPDATE "referral_commissions"
SET "recipient_id" = "referrer_id"
WHERE "recipient_id" IS NULL;

ALTER TABLE "referral_commissions"
  ALTER COLUMN "recipient_id" SET NOT NULL;