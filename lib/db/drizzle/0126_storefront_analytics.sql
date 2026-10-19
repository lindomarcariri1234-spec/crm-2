-- Publish can apply the schema diff before the API startup migrator records 0126.
CREATE TABLE IF NOT EXISTS "storefront_daily_metrics" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "store_id" text NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "metric_date" date NOT NULL,
  "event_type" text NOT NULL,
  "page_type" text NOT NULL DEFAULT 'none',
  "group_dimension" text NOT NULL DEFAULT 'none',
  "source_dimension" text NOT NULL DEFAULT 'none',
  "count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "storefront_daily_metrics_dimensions_uq"
  ON "storefront_daily_metrics" ("store_id", "metric_date", "event_type", "page_type", "group_dimension", "source_dimension");
CREATE INDEX IF NOT EXISTS "storefront_daily_metrics_tenant_date_idx"
  ON "storefront_daily_metrics" ("tenant_id", "metric_date");
