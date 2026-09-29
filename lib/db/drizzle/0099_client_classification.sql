ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "first_paid_at" timestamptz;
ALTER TABLE "clients" ALTER COLUMN "created_by_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "client_classification_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "client_id" text REFERENCES "clients"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "actor_id" text,
  "previous_classification" text,
  "new_classification" text,
  "reason" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_classification_events_tenant_idempotency_unique"
  ON "client_classification_events" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "client_classification_events_client_occurred_idx"
  ON "client_classification_events" ("tenant_id", "client_id", "occurred_at");