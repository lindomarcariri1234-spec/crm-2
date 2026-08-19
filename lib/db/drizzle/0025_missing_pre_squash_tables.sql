-- 0025: Create tables that exist in the Drizzle TypeScript schema and the
-- squash baseline (0000) but are absent from databases that were provisioned
-- before these tables were added to the baseline.
--
-- Affected tables (confirmed missing from dev DB via verify-db-columns.mjs):
--   • campaign_sends
--   • client_achievements
--   • client_dream_destinations
--   • redis_alert_log
--   • trip_media
--
-- All statements use CREATE TABLE IF NOT EXISTS — safe to re-run on any
-- database that already has these tables.

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_sends" (
        "id" text PRIMARY KEY NOT NULL,
        "campaign_id" text NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
        "status" text DEFAULT 'sent' NOT NULL,
        "error" text
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_achievements" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "badge_key" text NOT NULL,
        "earned_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "client_achievements_unique_badge" UNIQUE("client_id","tenant_id","badge_key")
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_dream_destinations" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "destination_name" text NOT NULL,
        "note" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "redis_alert_log" (
        "id" text PRIMARY KEY NOT NULL,
        "event_type" text NOT NULL,
        "alert_status" text,
        "email_to" text,
        "triggered_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trip_media" (
        "id" text PRIMARY KEY NOT NULL,
        "trip_id" text NOT NULL,
        "tenant_id" text NOT NULL,
        "url" text NOT NULL,
        "type" text DEFAULT 'image' NOT NULL,
        "caption" text,
        "uploaded_by_user_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
