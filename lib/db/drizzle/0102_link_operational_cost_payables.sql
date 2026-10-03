ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "source_expense_id" text,
  ADD COLUMN IF NOT EXISTS "source_trip_cost_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_source_expense_id_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_source_expense_id_fkey"
      FOREIGN KEY ("source_expense_id") REFERENCES "expenses"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_source_trip_cost_id_fkey'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_source_trip_cost_id_fkey"
      FOREIGN KEY ("source_trip_cost_id") REFERENCES "trip_costs"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_operational_cost_source_check'
  ) THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_operational_cost_source_check"
      CHECK (
        ("source_expense_id" IS NULL OR "source_trip_cost_id" IS NULL)
        AND (
          ("source_expense_id" IS NULL AND "source_trip_cost_id" IS NULL)
          OR "type" = 'payable'
        )
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_source_expense_id_unique"
  ON "payments" ("source_expense_id")
  WHERE "source_expense_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_source_trip_cost_id_unique"
  ON "payments" ("source_trip_cost_id")
  WHERE "source_trip_cost_id" IS NOT NULL;