-- Add co_passengers JSON column to store_orders so the vitrine wizard can
-- collect names (and optionally CPF/phone) for additional seats when qty > 1.
-- createReservationsForOrder reads this column (post-payment) to create one
-- passengersTable row per seat instead of a single row for the buyer only.
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "co_passengers" json;
