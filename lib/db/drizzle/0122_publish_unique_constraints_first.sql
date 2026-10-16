ALTER TABLE "reservations"
  DROP CONSTRAINT "reservations_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  DROP CONSTRAINT "trip_checkins_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  DROP CONSTRAINT "trip_checkins_reservation_trip_tenant_fk";
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  DROP CONSTRAINT "trip_checkins_passenger_reservation_fk";
--> statement-breakpoint
ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_trip_id_trips_id_fk"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id");
--> statement-breakpoint
ALTER TABLE "trip_checkins"
  ADD CONSTRAINT "trip_checkins_trip_id_trips_id_fk"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;
