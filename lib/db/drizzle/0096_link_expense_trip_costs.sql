ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "linked_trip_cost_id" text;

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_linked_trip_cost_id_trip_costs_id_fk'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_linked_trip_cost_id_trip_costs_id_fk"
      FOREIGN KEY ("linked_trip_cost_id")
      REFERENCES "trip_costs"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_linked_trip_cost_id_unique"
  ON "expenses" ("linked_trip_cost_id");