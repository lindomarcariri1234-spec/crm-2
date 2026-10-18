ALTER TABLE "calendar_events"
  ADD COLUMN IF NOT EXISTS "reservation_id" text,
  ADD COLUMN IF NOT EXISTS "attendee_email" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_tenant_reservation_unique"
  ON "calendar_events" ("tenant_id", "reservation_id")
  WHERE "reservation_id" IS NOT NULL;
