DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'store_orders' AND column_name = 'amount_remaining'
  ) THEN
    ALTER TABLE "store_orders" ADD COLUMN "amount_remaining" numeric(10, 2);
  END IF;
END $$;