-- Passengers under 7 with an assigned seat must use the child category.
-- The predicate keeps this data correction idempotent.
UPDATE "passengers"
SET "age_category" = 'child'
WHERE "is_child_under_7" = true
  AND "seat_number" IS NOT NULL
  AND "age_category" <> 'child';