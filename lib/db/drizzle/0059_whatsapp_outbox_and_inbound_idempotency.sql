ALTER TABLE IF EXISTS "whatsapp_notification_outbox"
  ADD COLUMN IF NOT EXISTS "reference_date" text NOT NULL DEFAULT 'confirmation',
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "provider" text;

ALTER TABLE IF EXISTS "whatsapp_notification_outbox"
  DROP CONSTRAINT IF EXISTS "whatsapp_notification_outbox_reservation_type_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_notification_outbox_reservation_type_reference_unique"
  ON "whatsapp_notification_outbox" ("tenant_id", "reservation_id", "type", "reference_date");

ALTER TABLE IF EXISTS "chatbot_messages"
  ADD COLUMN IF NOT EXISTS "source_message_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "chatbot_messages_tenant_source_message_unique"
  ON "chatbot_messages" ("tenant_id", "source_message_id")
  WHERE "source_message_id" IS NOT NULL;