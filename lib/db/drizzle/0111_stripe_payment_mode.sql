ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "stripe_livemode" boolean;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "is_test_mode" boolean NOT NULL DEFAULT false;
