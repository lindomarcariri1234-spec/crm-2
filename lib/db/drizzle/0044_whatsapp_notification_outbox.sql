CREATE TABLE IF NOT EXISTS "whatsapp_notification_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "reservation_id" text NOT NULL REFERENCES "reservations"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "enqueued_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_notification_outbox_reservation_type_unique"
    UNIQUE("tenant_id", "reservation_id", "type")
);

CREATE INDEX IF NOT EXISTS "whatsapp_notification_outbox_pending_idx"
  ON "whatsapp_notification_outbox" ("status", "created_at");