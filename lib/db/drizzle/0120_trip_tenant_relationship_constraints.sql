-- Before adding relational guards, attach legacy check-ins that omitted the
-- reservation ID only when the passenger's canonical reservation matches the
-- same trip and tenant. Existing non-null mismatches are deliberately not
-- rewritten; the preflight below stops the migration for review.
UPDATE trip_checkins AS c
SET reservation_id = p.reservation_id
FROM passengers AS p
JOIN reservations AS r ON r.id = p.reservation_id
WHERE c.reservation_id IS NULL
  AND p.id = c.passenger_id
  AND r.trip_id = c.trip_id
  AND r.tenant_id = c.tenant_id;
--> statement-breakpoint
DO $$
DECLARE
  invalid_reservations bigint;
  invalid_checkins bigint;
BEGIN
  SELECT COUNT(*) INTO invalid_reservations
  FROM reservations AS r
  LEFT JOIN trips AS t ON t.id = r.trip_id
  WHERE t.id IS NULL OR t.tenant_id IS DISTINCT FROM r.tenant_id;

  IF invalid_reservations > 0 THEN
    RAISE EXCEPTION
      'Cannot add trip tenant constraints: % reservations reference a trip from another tenant or a missing trip',
      invalid_reservations;
  END IF;

  SELECT COUNT(*) INTO invalid_checkins
  FROM trip_checkins AS c
  LEFT JOIN passengers AS p ON p.id = c.passenger_id
  LEFT JOIN reservations AS r ON r.id = p.reservation_id
  WHERE p.id IS NULL
     OR r.id IS NULL
     OR c.reservation_id IS NULL
     OR c.reservation_id IS DISTINCT FROM p.reservation_id
     OR r.trip_id IS DISTINCT FROM c.trip_id
     OR r.tenant_id IS DISTINCT FROM c.tenant_id;

  IF invalid_checkins > 0 THEN
    RAISE EXCEPTION
      'Cannot add trip tenant constraints: % check-ins have an invalid passenger, reservation, trip, or tenant relationship',
      invalid_checkins;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trips_id_tenant_id_unique"
  ON "trips" ("id", "tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_id_trip_tenant_unique"
  ON "reservations" ("id", "trip_id", "tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "passengers_id_reservation_unique"
  ON "passengers" ("id", "reservation_id");
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  ALTER COLUMN "reservation_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations"
  DROP CONSTRAINT IF EXISTS "reservations_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_trip_tenant_fk"
  FOREIGN KEY ("trip_id", "tenant_id")
  REFERENCES "trips" ("id", "tenant_id")
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "reservations"
  VALIDATE CONSTRAINT "reservations_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  DROP CONSTRAINT IF EXISTS "trip_checkins_trip_id_trips_id_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  ADD CONSTRAINT "trip_checkins_trip_tenant_fk"
  FOREIGN KEY ("trip_id", "tenant_id")
  REFERENCES "trips" ("id", "tenant_id")
  ON DELETE CASCADE
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  VALIDATE CONSTRAINT "trip_checkins_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  ADD CONSTRAINT "trip_checkins_reservation_trip_tenant_fk"
  FOREIGN KEY ("reservation_id", "trip_id", "tenant_id")
  REFERENCES "reservations" ("id", "trip_id", "tenant_id")
  ON DELETE CASCADE
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  VALIDATE CONSTRAINT "trip_checkins_reservation_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  ADD CONSTRAINT "trip_checkins_passenger_reservation_fk"
  FOREIGN KEY ("passenger_id", "reservation_id")
  REFERENCES "passengers" ("id", "reservation_id")
  ON DELETE CASCADE
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  VALIDATE CONSTRAINT "trip_checkins_passenger_reservation_fk";
