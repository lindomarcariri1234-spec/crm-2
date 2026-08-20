-- Durable idempotency ledger for Stripe webhook events.
-- Stripe delivers events at-least-once; the webhook handler claims each event
-- id here (INSERT … ON CONFLICT DO NOTHING RETURNING) BEFORE running any side
-- effect, so only the winning delivery proceeds and duplicates are no-ops.
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
