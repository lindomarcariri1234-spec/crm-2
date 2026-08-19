-- Add logistics columns to store_orders so the seat and boarding location
-- chosen by the customer during vitrine checkout are not silently discarded.
-- These are read by createReservationsForOrder (post-payment) to populate the
-- CRM reservation and passenger record instead of auto-assigning seat 1.
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "boarding_location_id" text;
ALTER TABLE "store_orders" ADD COLUMN IF NOT EXISTS "seats" json;
