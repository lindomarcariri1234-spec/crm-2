-- Reconcile the checked-in schema with columns already present in development
-- and production. Keep this migration additive and do not backfill or overwrite
-- existing values.
ALTER TABLE "email_logs"
  ADD COLUMN IF NOT EXISTS "notification_type" text;

CREATE INDEX IF NOT EXISTS "email_logs_tenant_referral_type_idx"
  ON "email_logs" USING btree ("tenant_id", "referral_id", "notification_type", "created_at");

ALTER TABLE "store_products"
  ADD COLUMN IF NOT EXISTS "accommodation_id" text;

CREATE INDEX IF NOT EXISTS "store_products_accommodation_id_idx"
  ON "store_products" USING btree ("accommodation_id");

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "accommodation_id" text;

DO $$
DECLARE
  trip_accommodation_attnum smallint;
  accommodation_id_attnum smallint;
BEGIN
  SELECT attnum INTO trip_accommodation_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.trips'::regclass
    AND attname = 'accommodation_id'
    AND NOT attisdropped;

  SELECT attnum INTO accommodation_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.accommodations'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF trip_accommodation_attnum IS NULL OR accommodation_id_attnum IS NULL THEN
    RAISE EXCEPTION 'Expected trips.accommodation_id and accommodations.id before adding the foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.trips'::regclass
      AND confrelid = 'public.accommodations'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[trip_accommodation_attnum]::smallint[]
      AND confkey = ARRAY[accommodation_id_attnum]::smallint[]
      AND confdeltype = 'n'
  ) THEN
    ALTER TABLE "trips"
      ADD CONSTRAINT "trips_accommodation_id_fkey"
      FOREIGN KEY ("accommodation_id")
      REFERENCES "accommodations"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;