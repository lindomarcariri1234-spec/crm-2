ALTER TABLE "store_orders"
  ADD COLUMN IF NOT EXISTS "stripe_refunded_amount" integer NOT NULL DEFAULT 0;
