CREATE TABLE IF NOT EXISTS "referral_attempt_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"client_id" text NOT NULL,
	"store_slug" text NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
