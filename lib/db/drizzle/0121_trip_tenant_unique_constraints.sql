ALTER TABLE "trips"
  ADD CONSTRAINT "trips_id_tenant_id_unique"
  UNIQUE USING INDEX "trips_id_tenant_id_unique";
--> statement-breakpoint
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_id_trip_tenant_unique"
  UNIQUE USING INDEX "reservations_id_trip_tenant_unique";
--> statement-breakpoint
ALTER TABLE "passengers"
  ADD CONSTRAINT "passengers_id_reservation_unique"
  UNIQUE USING INDEX "passengers_id_reservation_unique";
