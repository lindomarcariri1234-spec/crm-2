ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refund_of_payment_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_refund_of_payment_id_payments_id_fk"
    FOREIGN KEY ("refund_of_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_refund_of_payment_id_idx"
  ON "payments" ("refund_of_payment_id");
