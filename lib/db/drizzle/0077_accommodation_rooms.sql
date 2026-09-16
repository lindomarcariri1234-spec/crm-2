ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "accommodation_id" text REFERENCES "accommodations"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "accommodation_rooms" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "accommodation_id" text NOT NULL REFERENCES "accommodations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'standard',
  "capacity" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_rooms_accommodation_name_unique"
  ON "accommodation_rooms" ("accommodation_id", "name");
CREATE INDEX IF NOT EXISTS "accommodation_rooms_tenant_accommodation_idx"
  ON "accommodation_rooms" ("tenant_id", "accommodation_id");

CREATE TABLE IF NOT EXISTS "reservation_room_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "trip_id" text NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "reservation_id" text NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
  "passenger_id" text NOT NULL REFERENCES "passengers"("id") ON DELETE CASCADE,
  "room_id" text NOT NULL REFERENCES "accommodation_rooms"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "reservation_room_assignments_trip_passenger_unique"
  ON "reservation_room_assignments" ("trip_id", "passenger_id");
CREATE INDEX IF NOT EXISTS "reservation_room_assignments_trip_room_idx"
  ON "reservation_room_assignments" ("trip_id", "room_id");