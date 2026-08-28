CREATE TABLE IF NOT EXISTS "spreadsheet_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "entity" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "file_hash" text NOT NULL,
  "filename" text NOT NULL,
  "status" text DEFAULT 'completed' NOT NULL,
  "report" json NOT NULL,
  "created_by_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spreadsheet_import_batches_tenant_key_unique"
  ON "spreadsheet_import_batches" USING btree ("tenant_id", "entity", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spreadsheet_import_batches_tenant_created_idx"
  ON "spreadsheet_import_batches" USING btree ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spreadsheet_import_records" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "entity" text NOT NULL,
  "source_key" text NOT NULL,
  "target_id" text NOT NULL,
  "last_batch_id" text NOT NULL,
  "last_line" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spreadsheet_import_records_tenant_entity_key_unique"
  ON "spreadsheet_import_records" USING btree ("tenant_id", "entity", "source_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spreadsheet_import_records_target_idx"
  ON "spreadsheet_import_records" USING btree ("tenant_id", "entity", "target_id");