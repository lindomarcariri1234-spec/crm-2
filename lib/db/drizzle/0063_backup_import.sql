CREATE TABLE IF NOT EXISTS "backup_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "report" json NOT NULL,
  "created_by_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "backup_import_batches_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_import_batches_tenant_key_unique"
  ON "backup_import_batches" USING btree ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_import_records" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "source_id" text NOT NULL,
  "target_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "backup_import_records_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_import_records_tenant_entity_source_unique"
  ON "backup_import_records" USING btree ("tenant_id", "entity_type", "source_id");
