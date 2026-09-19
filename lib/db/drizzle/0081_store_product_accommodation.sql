ALTER TABLE "store_products"
  ADD COLUMN IF NOT EXISTS "accommodation_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_products_accommodation_id_idx" ON "store_products" ("accommodation_id");