ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS gratuity_amount numeric(10, 2) NOT NULL DEFAULT 0;