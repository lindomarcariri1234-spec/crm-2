DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'trips'::regclass
      AND conname = 'trips_id_tenant_id_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE "trips"
      ADD CONSTRAINT "trips_id_tenant_id_unique"
      UNIQUE USING INDEX "trips_id_tenant_id_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'reservations'::regclass
      AND conname = 'reservations_id_trip_tenant_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_id_trip_tenant_unique"
      UNIQUE USING INDEX "reservations_id_trip_tenant_unique";
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'passengers'::regclass
      AND conname = 'passengers_id_reservation_unique'
      AND contype = 'u'
  ) THEN
    ALTER TABLE "passengers"
      ADD CONSTRAINT "passengers_id_reservation_unique"
      UNIQUE USING INDEX "passengers_id_reservation_unique";
  END IF;
END $$;
