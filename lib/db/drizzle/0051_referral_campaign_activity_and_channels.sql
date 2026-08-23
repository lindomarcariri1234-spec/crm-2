ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "eligible_activity_segments" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_campaigns"
  ADD COLUMN IF NOT EXISTS "eligible_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "campaign_id" text;
--> statement-breakpoint
ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "attribution_channel" text;