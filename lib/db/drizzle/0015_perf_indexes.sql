-- Performance indexes for the hottest tenant-scoped read paths.
--
-- These back the list endpoints, dashboards and report exports that filter by
-- tenant_id (+ status) and sort/scan by created_at, plus the foreign-key
-- lookups used for seat availability, client history and payment idempotency.
-- They match the index() declarations now present in lib/db/src/schema/
-- {reservations,payments,trips}.ts (source of truth, so a future squash keeps
-- them).
--
-- Idempotent: every statement uses IF NOT EXISTS, so this is a no-op on
-- databases that already have the indexes and safe to run against both empty
-- and populated databases. Plain (non-CONCURRENT) CREATE INDEX is used because
-- the migrator runs each migration inside a transaction; the affected tables
-- are moderately sized so the brief build-time lock is acceptable.

CREATE INDEX IF NOT EXISTS reservations_tenant_id_created_at_idx ON reservations (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS reservations_trip_id_idx ON reservations (trip_id);
CREATE INDEX IF NOT EXISTS reservations_client_id_idx ON reservations (client_id);
CREATE INDEX IF NOT EXISTS reservations_tenant_id_status_idx ON reservations (tenant_id, status);

CREATE INDEX IF NOT EXISTS payments_tenant_id_created_at_idx ON payments (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS payments_reservation_id_idx ON payments (reservation_id);
CREATE INDEX IF NOT EXISTS payments_client_id_idx ON payments (client_id);
CREATE INDEX IF NOT EXISTS payments_tenant_id_status_idx ON payments (tenant_id, status);

CREATE INDEX IF NOT EXISTS expenses_tenant_id_created_at_idx ON expenses (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS expenses_trip_id_idx ON expenses (trip_id);

CREATE INDEX IF NOT EXISTS trips_tenant_id_departure_date_idx ON trips (tenant_id, departure_date);
CREATE INDEX IF NOT EXISTS trips_tenant_id_status_idx ON trips (tenant_id, status);
CREATE INDEX IF NOT EXISTS trips_slug_idx ON trips (slug);
