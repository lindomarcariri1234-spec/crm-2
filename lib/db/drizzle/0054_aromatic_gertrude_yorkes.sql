-- Existing catalogues may contain duplicate title-derived slugs. Keep the
-- earliest row stable and make later rows unique before enforcing the
-- seller-scoped invariant.
WITH duplicate_slugs AS (
  SELECT "id", "slug",
    row_number() OVER (
      PARTITION BY "partner_id", "slug"
      ORDER BY "created_at", "id"
    ) AS row_number
  FROM "partner_products"
)
UPDATE "partner_products" AS product
SET "slug" = product."slug" || '-duplicate-' || product."id"
FROM duplicate_slugs
WHERE product."id" = duplicate_slugs."id"
  AND duplicate_slugs.row_number > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "partner_products_partner_slug_unique" ON "partner_products" USING btree ("partner_id","slug");