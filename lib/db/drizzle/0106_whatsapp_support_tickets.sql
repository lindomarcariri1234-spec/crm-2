CREATE TABLE IF NOT EXISTS "support_queues" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_queues_tenant_slug_unique" UNIQUE ("tenant_id", "slug")
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_queues_one_default_per_tenant_unique"
  ON "support_queues" ("tenant_id")
  WHERE "is_default" = true;

CREATE INDEX IF NOT EXISTS "support_queues_tenant_active_idx"
  ON "support_queues" ("tenant_id", "is_active", "name");

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "conversation_id" text NOT NULL REFERENCES "chatbot_conversations"("id") ON DELETE CASCADE,
  "client_id" text REFERENCES "clients"("id") ON DELETE SET NULL,
  "queue_id" text REFERENCES "support_queues"("id") ON DELETE SET NULL,
  "assigned_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "priority" text NOT NULL DEFAULT 'normal',
  "subject" text,
  "last_message_at" timestamptz NOT NULL DEFAULT now(),
  "first_response_at" timestamptz,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "support_tickets_status_check" CHECK ("status" IN ('pending', 'open', 'resolved')),
  CONSTRAINT "support_tickets_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_one_active_per_conversation_unique"
  ON "support_tickets" ("tenant_id", "conversation_id")
  WHERE "status" <> 'resolved';

CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_activity_idx"
  ON "support_tickets" ("tenant_id", "status", "last_message_at");

CREATE INDEX IF NOT EXISTS "support_tickets_tenant_queue_status_activity_idx"
  ON "support_tickets" ("tenant_id", "queue_id", "status", "last_message_at");

CREATE INDEX IF NOT EXISTS "support_tickets_tenant_assignee_status_activity_idx"
  ON "support_tickets" ("tenant_id", "assigned_user_id", "status", "last_message_at");

CREATE TABLE IF NOT EXISTS "support_ticket_events" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "ticket_id" text NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "actor_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "support_ticket_events_tenant_ticket_created_idx"
  ON "support_ticket_events" ("tenant_id", "ticket_id", "created_at");

CREATE TABLE IF NOT EXISTS "support_quick_replies" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "queue_id" text REFERENCES "support_queues"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "shortcut" text NOT NULL,
  "content" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_quick_replies_tenant_shortcut_unique"
  ON "support_quick_replies" ("tenant_id", lower("shortcut"));

CREATE INDEX IF NOT EXISTS "support_quick_replies_tenant_active_idx"
  ON "support_quick_replies" ("tenant_id", "is_active", "title");

ALTER TABLE "chatbot_messages"
  ADD COLUMN IF NOT EXISTS "ticket_id" text
    REFERENCES "support_tickets"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "chatbot_messages_ticket_sent_idx"
  ON "chatbot_messages" ("ticket_id", "sent_at");
