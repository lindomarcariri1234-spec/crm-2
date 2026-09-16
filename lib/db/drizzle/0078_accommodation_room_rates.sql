ALTER TABLE "accommodation_rooms"
  ADD COLUMN IF NOT EXISTS "price_per_night" numeric(10, 2);