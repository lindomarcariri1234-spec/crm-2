CREATE TABLE IF NOT EXISTS "properties" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legacy_accommodation_id" text REFERENCES "accommodations"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "legal_name" text,
  "trade_name" text,
  "property_type" text DEFAULT 'OTHER' NOT NULL,
  "description" text,
  "document_number" text,
  "email" text,
  "phone" text,
  "website" text,
  "address" text,
  "city" text,
  "state" text,
  "timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "locale" text DEFAULT 'pt-BR' NOT NULL,
  "check_in_time" text DEFAULT '14:00' NOT NULL,
  "check_out_time" text DEFAULT '12:00' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "properties_tenant_legacy_accommodation_unique"
  ON "properties" ("tenant_id", "legacy_accommodation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "properties_tenant_status_idx"
  ON "properties" ("tenant_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "room_types" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "legacy_category" text,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "max_occupancy" integer DEFAULT 1 NOT NULL,
  "base_occupancy" integer DEFAULT 1 NOT NULL,
  "default_price" numeric(12, 2),
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "room_types_property_code_unique"
  ON "room_types" ("property_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_types_tenant_property_idx"
  ON "room_types" ("tenant_id", "property_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "accommodation_units" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "room_type_id" text NOT NULL REFERENCES "room_types"("id") ON DELETE RESTRICT,
  "legacy_room_id" text REFERENCES "accommodation_rooms"("id") ON DELETE SET NULL,
  "unit_number" text NOT NULL,
  "name" text NOT NULL,
  "floor" text,
  "max_occupancy" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "housekeeping_status" text DEFAULT 'CLEAN' NOT NULL,
  "maintenance_status" text DEFAULT 'AVAILABLE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_units_property_number_unique"
  ON "accommodation_units" ("property_id", "unit_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accommodation_units_tenant_legacy_room_unique"
  ON "accommodation_units" ("tenant_id", "legacy_room_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accommodation_units_tenant_type_idx"
  ON "accommodation_units" ("tenant_id", "room_type_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "rate_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "pricing_model" text DEFAULT 'PER_ROOM' NOT NULL,
  "meal_plan" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_plans_property_code_unique"
  ON "rate_plans" ("property_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_plans_tenant_property_idx"
  ON "rate_plans" ("tenant_id", "property_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "rate_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "rate_plan_id" text NOT NULL REFERENCES "rate_plans"("id") ON DELETE CASCADE,
  "room_type_id" text NOT NULL REFERENCES "room_types"("id") ON DELETE CASCADE,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "price" numeric(12, 2) NOT NULL,
  "minimum_stay" integer,
  "maximum_stay" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_rules_lookup_idx"
  ON "rate_rules" ("tenant_id", "rate_plan_id", "room_type_id", "start_date", "end_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inventory_calendar" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "room_type_id" text NOT NULL REFERENCES "room_types"("id") ON DELETE CASCADE,
  "unit_id" text REFERENCES "accommodation_units"("id") ON DELETE CASCADE,
  "inventory_date" date NOT NULL,
  "available" integer DEFAULT 0 NOT NULL,
  "reserved" integer DEFAULT 0 NOT NULL,
  "blocked" integer DEFAULT 0 NOT NULL,
  "out_of_order" integer DEFAULT 0 NOT NULL,
  "maintenance" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_calendar_unit_date_unique"
  ON "inventory_calendar" ("unit_id", "inventory_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_calendar_property_date_idx"
  ON "inventory_calendar" ("tenant_id", "property_id", "inventory_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pms_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE RESTRICT,
  "legacy_reservation_id" text,
  "client_id" text,
  "reservation_number" text NOT NULL,
  "source" text DEFAULT 'DIRECT' NOT NULL,
  "channel" text DEFAULT 'CRM' NOT NULL,
  "status" text DEFAULT 'HELD' NOT NULL,
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "adults" integer DEFAULT 1 NOT NULL,
  "children" integer DEFAULT 0 NOT NULL,
  "infants" integer DEFAULT 0 NOT NULL,
  "total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "balance_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "notes" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pms_reservations_tenant_number_unique"
  ON "pms_reservations" ("tenant_id", "reservation_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pms_reservations_tenant_dates_idx"
  ON "pms_reservations" ("tenant_id", "property_id", "check_in", "check_out");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pms_reservations_tenant_status_idx"
  ON "pms_reservations" ("tenant_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reservation_units" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "reservation_id" text NOT NULL REFERENCES "pms_reservations"("id") ON DELETE CASCADE,
  "room_type_id" text NOT NULL REFERENCES "room_types"("id") ON DELETE RESTRICT,
  "unit_id" text REFERENCES "accommodation_units"("id") ON DELETE RESTRICT,
  "rate_plan_id" text REFERENCES "rate_plans"("id") ON DELETE SET NULL,
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "adults" integer DEFAULT 1 NOT NULL,
  "children" integer DEFAULT 0 NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_units_tenant_reservation_idx"
  ON "reservation_units" ("tenant_id", "reservation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_units_tenant_type_dates_idx"
  ON "reservation_units" ("tenant_id", "room_type_id", "check_in", "check_out");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_units_tenant_unit_dates_idx"
  ON "reservation_units" ("tenant_id", "unit_id", "check_in", "check_out");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "guest_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "full_name" text NOT NULL,
  "document_type" text,
  "document_number" text,
  "birth_date" date,
  "nationality" text,
  "email" text,
  "phone" text,
  "preferences" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_profiles_tenant_name_idx"
  ON "guest_profiles" ("tenant_id", "full_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_profiles_tenant_document_idx"
  ON "guest_profiles" ("tenant_id", "document_number");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reservation_guests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "reservation_id" text NOT NULL REFERENCES "pms_reservations"("id") ON DELETE CASCADE,
  "reservation_unit_id" text REFERENCES "reservation_units"("id") ON DELETE SET NULL,
  "guest_profile_id" text REFERENCES "guest_profiles"("id") ON DELETE SET NULL,
  "full_name" text NOT NULL,
  "document_type" text,
  "document_number" text,
  "birth_date" date,
  "guest_type" text DEFAULT 'ADULT' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_guests_tenant_reservation_idx"
  ON "reservation_guests" ("tenant_id", "reservation_id");
--> statement-breakpoint

-- Backfill the additive PMS projection from existing accommodation records.
-- All IDs are deterministic, so this is safe to rerun.
INSERT INTO "properties" (
  "id", "tenant_id", "legacy_accommodation_id", "name", "trade_name",
  "property_type", "email", "phone", "address", "city", "state",
  "currency", "status", "created_at", "updated_at"
)
SELECT
  'legacy-property-' || a."id",
  a."tenant_id",
  a."id",
  a."name",
  a."name",
  upper(a."type"),
  a."email",
  a."phone",
  a."address",
  a."city",
  a."state",
  'BRL',
  a."status",
  a."created_at",
  a."updated_at"
FROM "accommodations" a
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "room_types" (
  "id", "tenant_id", "property_id", "legacy_category", "name", "code",
  "max_occupancy", "base_occupancy", "default_price", "status"
)
SELECT
  'legacy-room-type-' || md5(a."id" || ':' || lower(r."category")),
  a."tenant_id",
  'legacy-property-' || a."id",
  r."category",
  initcap(replace(r."category", '_', ' ')),
  'LEGACY_' || md5(a."id" || ':' || lower(r."category")),
  max(r."capacity"),
  max(coalesce(r."standard_occupancy", r."capacity")),
  min(r."price_per_night"),
  CASE WHEN bool_or(r."is_active" AND r."status" = 'active') THEN 'active' ELSE 'inactive' END
FROM "accommodation_rooms" r
JOIN "accommodations" a ON a."id" = r."accommodation_id"
GROUP BY a."id", a."tenant_id", r."category"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "accommodation_units" (
  "id", "tenant_id", "property_id", "room_type_id", "legacy_room_id",
  "unit_number", "name", "floor", "max_occupancy", "status",
  "housekeeping_status", "maintenance_status", "created_at", "updated_at"
)
SELECT
  'legacy-unit-' || r."id",
  r."tenant_id",
  'legacy-property-' || r."accommodation_id",
  'legacy-room-type-' || md5(r."accommodation_id" || ':' || lower(r."category")),
  r."id",
  r."name",
  r."name",
  r."floor",
  r."capacity",
  CASE WHEN r."is_active" AND r."status" = 'active' THEN 'active' ELSE 'inactive' END,
  'CLEAN',
  'AVAILABLE',
  r."created_at",
  r."updated_at"
FROM "accommodation_rooms" r
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "rate_plans" (
  "id", "tenant_id", "property_id", "name", "code", "pricing_model", "status"
)
SELECT
  'legacy-rate-plan-' || p."id",
  p."tenant_id",
  p."id",
  'Tarifa pública',
  'BAR',
  'PER_ROOM',
  'active'
FROM "properties" p
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "rate_rules" (
  "id", "tenant_id", "rate_plan_id", "room_type_id", "start_date",
  "end_date", "price", "minimum_stay", "maximum_stay", "status",
  "created_at", "updated_at"
)
SELECT
  'legacy-rate-rule-' || r."id",
  r."tenant_id",
  'legacy-rate-plan-legacy-property-' || r."accommodation_id",
  'legacy-room-type-' || md5(r."accommodation_id" || ':' || lower(coalesce(ar."category", 'standard'))),
  r."valid_from",
  r."valid_to",
  r."amount",
  r."min_nights",
  r."max_nights",
  r."status",
  r."created_at",
  r."updated_at"
FROM "accommodation_rates" r
LEFT JOIN "accommodation_rooms" ar ON ar."id" = r."room_id"
JOIN "room_types" rt
  ON rt."id" = 'legacy-room-type-' ||
    md5(r."accommodation_id" || ':' || lower(coalesce(ar."category", r."category", '')))
  AND rt."tenant_id" = r."tenant_id"
ON CONFLICT ("id") DO NOTHING;