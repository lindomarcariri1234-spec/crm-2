ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "bounced_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "failed_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "complained_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "failure_tracking_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "bounced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "failed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "complained_at" timestamp with time zone;
