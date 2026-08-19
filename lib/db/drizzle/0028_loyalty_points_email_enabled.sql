ALTER TABLE "referral_settings" ADD COLUMN IF NOT EXISTS "loyalty_points_email_enabled" boolean NOT NULL DEFAULT true;
