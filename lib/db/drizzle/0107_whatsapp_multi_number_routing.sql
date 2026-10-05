-- Allow multiple Evolution WhatsApp connections per tenant while retaining
-- singleton semantics for all other integration types.
ALTER TABLE "tenant_integrations"
  DROP CONSTRAINT IF EXISTS "tenant_integrations_tenant_type_uq";

ALTER TABLE "tenant_integrations"
  ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;

-- The pre-existing unique constraint meant each tenant had at most one
-- Evolution connection. Preserve it as the default sender for legacy traffic.
UPDATE "tenant_integrations"
SET "is_default" = true
WHERE "type" = 'whatsapp_evolution'
  AND NOT EXISTS (
    SELECT 1
    FROM "tenant_integrations" AS existing_default
    WHERE existing_default."tenant_id" = "tenant_integrations"."tenant_id"
      AND existing_default."type" = 'whatsapp_evolution'
      AND existing_default."is_default" = true
  );

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_integrations_tenant_type_uq"
  ON "tenant_integrations" ("tenant_id", "type")
  WHERE "type" <> 'whatsapp_evolution';

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_integrations_whatsapp_default_uq"
  ON "tenant_integrations" ("tenant_id")
  WHERE "type" = 'whatsapp_evolution' AND "is_default" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_integrations_whatsapp_instance_uq"
  ON "tenant_integrations" ("tenant_id", ("config" ->> 'instanceName'))
  WHERE "type" = 'whatsapp_evolution' AND "config" ? 'instanceName';

ALTER TABLE "chatbot_conversations"
  ADD COLUMN IF NOT EXISTS "whatsapp_integration_id" text;

ALTER TABLE "support_tickets"
  ADD COLUMN IF NOT EXISTS "whatsapp_integration_id" text;

CREATE INDEX IF NOT EXISTS "chatbot_conversations_tenant_whatsapp_connection_idx"
  ON "chatbot_conversations" ("tenant_id", "channel", "whatsapp_integration_id", "session_id");
