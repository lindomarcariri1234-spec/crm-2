DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'deposit_amount'
  ) THEN
    ALTER TABLE "reservations" ADD COLUMN "deposit_amount" numeric(10, 2);
  END IF;
END $$;