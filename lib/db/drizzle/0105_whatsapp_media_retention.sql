ALTER TABLE IF EXISTS "chatbot_messages"
  ADD COLUMN IF NOT EXISTS "media_expired_at" timestamptz;

CREATE INDEX IF NOT EXISTS "chatbot_messages_media_retention_idx"
  ON "chatbot_messages" ("sent_at")
  WHERE "media_url" IS NOT NULL AND "media_expired_at" IS NULL;