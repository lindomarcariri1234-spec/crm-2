ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "email_delivered_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "engagement_tracking_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "email_delivered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_sends"
  ADD COLUMN IF NOT EXISTS "clicked_at" timestamp with time zone;
