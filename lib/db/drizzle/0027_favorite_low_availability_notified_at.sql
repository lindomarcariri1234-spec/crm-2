ALTER TABLE "client_favorites" ADD COLUMN IF NOT EXISTS "low_availability_notified_at" timestamp with time zone;
