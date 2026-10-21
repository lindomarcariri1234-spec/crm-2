ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refunded_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "payments"
SET "refunded_at" = "updated_at"
WHERE "status" = 'refunded'
  AND "type" = 'receivable'
  AND "category" <> 'stripe_refund'
  AND "gateway" IS DISTINCT FROM 'stripe'
  AND "amount" > 0
  AND "refunded_at" IS NULL;
