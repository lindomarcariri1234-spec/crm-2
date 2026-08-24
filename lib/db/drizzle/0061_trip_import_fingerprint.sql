ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "import_fingerprint" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trips_tenant_import_fingerprint_unique"
  ON "trips" USING btree ("tenant_id", "import_fingerprint");