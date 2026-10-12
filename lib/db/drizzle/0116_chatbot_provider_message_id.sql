ALTER TABLE chatbot_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS chatbot_messages_tenant_provider_message_unique
  ON chatbot_messages (tenant_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
