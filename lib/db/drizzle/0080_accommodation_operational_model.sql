ALTER TABLE "accommodation_rooms"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "standard_occupancy" integer,
  ADD COLUMN IF NOT EXISTS "bed_configuration" text,
  ADD COLUMN IF NOT EXISTS "bathroom_type" text,
  ADD COLUMN IF NOT EXISTS "floor" text,
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "created_by" text,
  ADD COLUMN IF NOT EXISTS "updated_by" text;

CREATE TABLE IF NOT EXISTS "trip_accommodations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "trip_id" text NOT NULL,
  "accommodation_id" text NOT NULL,
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "nights" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "is_primary" boolean NOT NULL DEFAULT false,
  "pricing_policy" text NOT NULL DEFAULT 'CURRENT_RATE',
  "contracted_price" numeric(12, 2),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_accommodations_tenant_trip_idx" ON "trip_accommodations" ("tenant_id", "trip_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_accommodations_tenant_accommodation_idx" ON "trip_accommodations" ("tenant_id", "accommodation_id");
--> statement-breakpoint
ALTER TABLE "trip_accommodations" ADD CONSTRAINT "trip_accommodations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "trip_accommodations" ADD CONSTRAINT "trip_accommodations_accommodation_fk" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS "accommodation_room_beds" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "room_id" text NOT NULL,
  "name" text NOT NULL,
  "bed_type" text NOT NULL DEFAULT 'single',
  "capacity" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_room_beds_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_beds_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_room_beds_tenant_room_idx" ON "accommodation_room_beds" ("tenant_id", "room_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_room_beds_room_name_unique" ON "accommodation_room_beds" ("room_id", "name");

CREATE TABLE IF NOT EXISTS "accommodation_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "accommodation_id" text NOT NULL,
  "room_id" text,
  "category" text,
  "valid_from" date NOT NULL,
  "valid_to" date NOT NULL,
  "pricing_type" text NOT NULL DEFAULT 'PER_ROOM',
  "amount" numeric(12, 2) NOT NULL,
  "min_nights" integer,
  "max_nights" integer,
  "min_occupancy" integer,
  "max_occupancy" integer,
  "priority" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_rates_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_rates_accommodation_fk" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_rates_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_rates_valid_period_check" CHECK ("valid_to" > "valid_from")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_rates_lookup_idx" ON "accommodation_rates" ("tenant_id", "accommodation_id", "valid_from", "valid_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_rates_room_idx" ON "accommodation_rates" ("room_id", "valid_from", "valid_to");

CREATE TABLE IF NOT EXISTS "accommodation_rate_history" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "rate_id" text NOT NULL,
  "action" text NOT NULL,
  "previous_value" numeric(12, 2),
  "new_value" numeric(12, 2),
  "previous_period" text,
  "new_period" text,
  "changed_by" text,
  "change_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_rate_history_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_rate_history_rate_fk" FOREIGN KEY ("rate_id") REFERENCES "accommodation_rates"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_rate_history_rate_idx" ON "accommodation_rate_history" ("tenant_id", "rate_id", "created_at");

CREATE TABLE IF NOT EXISTS "accommodation_room_inventory" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "room_id" text NOT NULL,
  "inventory_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'available',
  "capacity_override" integer,
  "blocked_reason" text,
  "maintenance_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_room_inventory_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_inventory_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_room_inventory_room_date_unique" ON "accommodation_room_inventory" ("room_id", "inventory_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_room_inventory_tenant_date_idx" ON "accommodation_room_inventory" ("tenant_id", "inventory_date");

CREATE TABLE IF NOT EXISTS "accommodation_room_blocks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "accommodation_id" text NOT NULL,
  "room_id" text,
  "bed_id" text,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "block_type" text NOT NULL DEFAULT 'maintenance',
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_room_blocks_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_blocks_accommodation_fk" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_blocks_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_blocks_bed_fk" FOREIGN KEY ("bed_id") REFERENCES "accommodation_room_beds"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_blocks_period_check" CHECK ("end_date" > "start_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_room_blocks_lookup_idx" ON "accommodation_room_blocks" ("tenant_id", "accommodation_id", "start_date", "end_date");

CREATE TABLE IF NOT EXISTS "accommodation_stays" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "accommodation_id" text NOT NULL,
  "trip_accommodation_id" text,
  "trip_id" text,
  "reservation_id" text,
  "store_order_id" text,
  "client_id" text,
  "source" text NOT NULL DEFAULT 'CRM_MANUAL',
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "nights" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "pricing_type" text,
  "contracted_total" numeric(12, 2),
  "frozen_total" numeric(12, 2),
  "actual_check_in_at" timestamp with time zone,
  "actual_check_out_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_stays_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_stays_accommodation_fk" FOREIGN KEY ("accommodation_id") REFERENCES "accommodations"("id") ON DELETE RESTRICT,
  CONSTRAINT "accommodation_stays_trip_accommodation_fk" FOREIGN KEY ("trip_accommodation_id") REFERENCES "trip_accommodations"("id") ON DELETE SET NULL,
  CONSTRAINT "accommodation_stays_period_check" CHECK ("check_out" > "check_in")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_stays_tenant_dates_idx" ON "accommodation_stays" ("tenant_id", "accommodation_id", "check_in", "check_out");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_stays_trip_idx" ON "accommodation_stays" ("tenant_id", "trip_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_stays_reservation_idx" ON "accommodation_stays" ("tenant_id", "reservation_id");

CREATE TABLE IF NOT EXISTS "accommodation_stay_guests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "stay_id" text NOT NULL,
  "client_id" text,
  "passenger_id" text,
  "name" text NOT NULL,
  "document" text,
  "guest_type" text NOT NULL DEFAULT 'adult',
  "status" text NOT NULL DEFAULT 'expected',
  "actual_check_in_at" timestamp with time zone,
  "actual_check_out_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_stay_guests_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_stay_guests_stay_fk" FOREIGN KEY ("stay_id") REFERENCES "accommodation_stays"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_stay_guests_stay_idx" ON "accommodation_stay_guests" ("tenant_id", "stay_id");

CREATE TABLE IF NOT EXISTS "accommodation_stay_rate_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "stay_id" text NOT NULL,
  "room_id" text,
  "stay_guest_id" text,
  "rate_id" text,
  "pricing_type" text NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "quantity" integer NOT NULL,
  "nights" integer NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL,
  "source" text NOT NULL DEFAULT 'RATE',
  "is_manual_override" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_stay_rate_lines_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_stay_rate_lines_stay_fk" FOREIGN KEY ("stay_id") REFERENCES "accommodation_stays"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_stay_rate_lines_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE SET NULL,
  CONSTRAINT "accommodation_stay_rate_lines_guest_fk" FOREIGN KEY ("stay_guest_id") REFERENCES "accommodation_stay_guests"("id") ON DELETE SET NULL,
  CONSTRAINT "accommodation_stay_rate_lines_rate_fk" FOREIGN KEY ("rate_id") REFERENCES "accommodation_rates"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_stay_rate_lines_stay_idx" ON "accommodation_stay_rate_lines" ("tenant_id", "stay_id");

CREATE TABLE IF NOT EXISTS "accommodation_room_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "stay_id" text NOT NULL,
  "stay_guest_id" text NOT NULL,
  "room_id" text NOT NULL,
  "bed_id" text,
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "unassigned_at" timestamp with time zone,
  "assigned_by" text,
  "unassigned_by" text,
  "change_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "accommodation_room_assignments_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_assignments_stay_fk" FOREIGN KEY ("stay_id") REFERENCES "accommodation_stays"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_assignments_guest_fk" FOREIGN KEY ("stay_guest_id") REFERENCES "accommodation_stay_guests"("id") ON DELETE CASCADE,
  CONSTRAINT "accommodation_room_assignments_room_fk" FOREIGN KEY ("room_id") REFERENCES "accommodation_rooms"("id") ON DELETE RESTRICT,
  CONSTRAINT "accommodation_room_assignments_bed_fk" FOREIGN KEY ("bed_id") REFERENCES "accommodation_room_beds"("id") ON DELETE RESTRICT,
  CONSTRAINT "accommodation_room_assignments_period_check" CHECK ("check_out" > "check_in")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_room_assignments_stay_idx" ON "accommodation_room_assignments" ("tenant_id", "stay_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_room_assignments_room_dates_idx" ON "accommodation_room_assignments" ("tenant_id", "room_id", "check_in", "check_out");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_room_assignments_active_guest_unique" ON "accommodation_room_assignments" ("tenant_id", "stay_guest_id") WHERE "unassigned_at" IS NULL;