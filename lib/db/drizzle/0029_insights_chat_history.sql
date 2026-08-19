CREATE TABLE IF NOT EXISTS "insights_chat_history" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_type" text NOT NULL,
	"messages" json DEFAULT '[]' NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "insights_chat_history_unique" UNIQUE("tenant_id","user_id","chat_type")
);
