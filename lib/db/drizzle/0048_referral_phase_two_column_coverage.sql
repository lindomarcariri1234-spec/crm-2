-- Keep each additive column in an individual statement so schema coverage
-- validation can prove that upgrades and fresh baselines stay equivalent.
ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "eligible_tier_levels" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "conversion_cap" integer;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "budget_amount" numeric(12, 2);

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "share_message" text;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "material_url" text;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "public_ranking" boolean DEFAULT false NOT NULL;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "commission_type" text DEFAULT 'none' NOT NULL;

ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "commission_value" numeric(10, 4) DEFAULT '0' NOT NULL;