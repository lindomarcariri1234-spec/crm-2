ALTER TABLE IF EXISTS "chatbot_messages"
  ADD COLUMN IF NOT EXISTS "delivery_status" text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS "delivery_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delivery_updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_delivery_error" text;

CREATE INDEX IF NOT EXISTS "chatbot_messages_pending_delivery_idx"
  ON "chatbot_messages" ("tenant_id", "delivery_status", "delivery_updated_at");