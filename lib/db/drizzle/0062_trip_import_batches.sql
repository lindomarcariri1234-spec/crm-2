CREATE TABLE IF NOT EXISTS "trip_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "results" json DEFAULT '[]'::json NOT NULL,
  "created_by_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trip_import_batches_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trip_import_batches_tenant_key_unique"
  ON "trip_import_batches" USING btree ("tenant_id", "idempotency_key");