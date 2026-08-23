-- Marketplace operational ownership: line items preserve their vendor and
-- lifecycle, while partner offers gain structured public location/FAQ content.
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "partner_id" text;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "partner_product_id" text;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "seller_name" text;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "item_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "voucher_code" text;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "cancellation_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "store_order_items" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "partner_products" ADD COLUMN IF NOT EXISTS "origin" text;
--> statement-breakpoint
ALTER TABLE "partner_products" ADD COLUMN IF NOT EXISTS "location_url" text;
--> statement-breakpoint
ALTER TABLE "partner_products" ADD COLUMN IF NOT EXISTS "faq" json DEFAULT '[]'::json NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_order_items_partner_id_idx" ON "store_order_items" USING btree ("partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_order_items_partner_product_id_idx" ON "store_order_items" USING btree ("partner_product_id");
--> statement-breakpoint
-- Older installations may have more than one availability row for the same
-- offer/date. Keep the oldest row, use the greatest configured capacity, and
-- conservatively sum consumption (capped at that capacity) before enforcing
-- the one-row invariant.
WITH duplicate_availability AS (
  SELECT
    "product_id",
    "date",
    MIN("id") AS canonical_id,
    MAX("spots_total") AS canonical_total,
    LEAST(MAX("spots_total"), SUM("spots_used")) AS canonical_used
  FROM "partner_availability"
  GROUP BY "product_id", "date"
  HAVING COUNT(*) > 1
)
UPDATE "partner_availability" AS availability
SET
  "spots_total" = duplicate_availability.canonical_total,
  "spots_used" = duplicate_availability.canonical_used,
  "updated_at" = now()
FROM duplicate_availability
WHERE availability."id" = duplicate_availability.canonical_id;
--> statement-breakpoint
DELETE FROM "partner_availability" AS duplicate
USING (
  SELECT "product_id", "date", MIN("id") AS canonical_id
  FROM "partner_availability"
  GROUP BY "product_id", "date"
  HAVING COUNT(*) > 1
) AS duplicate_groups
WHERE duplicate."product_id" = duplicate_groups."product_id"
  AND duplicate."date" = duplicate_groups."date"
  AND duplicate."id" <> duplicate_groups.canonical_id;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "partner_availability_product_date_unique" ON "partner_availability" USING btree ("product_id","date");