ALTER TABLE "accommodation_rates"
  ADD COLUMN IF NOT EXISTS "reservation_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_rates_reservation_idx"
  ON "accommodation_rates" ("tenant_id", "reservation_id", "valid_from", "valid_to");