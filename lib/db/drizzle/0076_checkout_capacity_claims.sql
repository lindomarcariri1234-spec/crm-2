ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "capacity_units" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "reservations"
SET "capacity_units" = COALESCE(cardinality("seats"), 0)
WHERE "capacity_units" = 0
  AND cardinality("seats") > 0;
--> statement-breakpoint
ALTER TABLE "store_order_items"
  ADD COLUMN IF NOT EXISTS "inventory_claimed_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_order_items"
  ADD COLUMN IF NOT EXISTS "inventory_state" text;
--> statement-breakpoint
ALTER TABLE "store_order_items"
  ADD COLUMN IF NOT EXISTS "sales_count_applied" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_order_items"
  ADD COLUMN IF NOT EXISTS "partner_capacity_claimed_quantity" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_active_store_order_trip_unique"
  ON "reservations" ("tenant_id", "store_order_id", "trip_id")
  WHERE "store_order_id" IS NOT NULL AND "status" IN ('pending', 'confirmed');