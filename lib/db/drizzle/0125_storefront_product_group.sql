ALTER TABLE "store_products"
  ADD COLUMN IF NOT EXISTS "storefront_group" text;
--> statement-breakpoint
UPDATE "store_products"
SET "storefront_group" = CASE
  WHEN "trip_id" IS NOT NULL OR "type" IN ('trip', 'package', 'tour', 'cruise') THEN 'travel'
  ELSE 'other'
END
WHERE "storefront_group" IS NULL;
--> statement-breakpoint
ALTER TABLE "store_products"
  ALTER COLUMN "storefront_group" SET DEFAULT 'other',
  ALTER COLUMN "storefront_group" SET NOT NULL;
