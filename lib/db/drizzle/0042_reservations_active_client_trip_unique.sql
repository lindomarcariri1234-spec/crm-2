-- Migration 0042: Prevent duplicate active reservations for the same client on the same trip.
-- Partial unique index: covers only non-cancelled/non-refunded rows and only rows with a known client.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_client_trip_unique
  ON reservations (tenant_id, client_id, trip_id)
  WHERE status NOT IN ('cancelled', 'refunded')
    AND client_id IS NOT NULL;
