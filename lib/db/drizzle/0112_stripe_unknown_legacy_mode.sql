ALTER TABLE "payments"
  ALTER COLUMN "is_test_mode" DROP NOT NULL;

UPDATE "payments" AS payment
SET "is_test_mode" = NOT store_order."stripe_livemode"
FROM "store_orders" AS store_order
WHERE payment."gateway" = 'stripe'
  AND payment."order_id" = store_order."id"
  AND store_order."stripe_livemode" IS NOT NULL;

UPDATE "payments" AS payment
SET "is_test_mode" = NULL
WHERE payment."gateway" = 'stripe'
  AND payment."is_test_mode" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "store_orders" AS store_order
    WHERE store_order."id" = payment."order_id"
      AND store_order."stripe_livemode" IS NOT NULL
  );
