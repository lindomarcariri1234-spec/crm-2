ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "referral_code_status" text NOT NULL DEFAULT 'active';

ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "discount_expiration_days" integer NOT NULL DEFAULT 30;
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "min_purchase_amount" numeric(10, 2);
ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "max_referrals_per_user" integer NOT NULL DEFAULT 0;
