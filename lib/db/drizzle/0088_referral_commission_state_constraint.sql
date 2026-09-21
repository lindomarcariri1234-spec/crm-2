-- Paid referral commissions in the existing flow may be inserted before a
-- settlement timestamp is recorded. Keep the database invariant focused on
-- contradictory pending/reversed states instead of requiring paid_at for a
-- status that the application does not populate consistently.

ALTER TABLE "referral_commissions"
  DROP CONSTRAINT IF EXISTS "referral_commissions_payment_consistency_check";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_pending_payment_check') THEN
    ALTER TABLE "referral_commissions"
      ADD CONSTRAINT "referral_commissions_pending_payment_check"
      CHECK ("status" NOT IN ('pending', 'approved') OR "paid_at" IS NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_reversal_consistency_check') THEN
    ALTER TABLE "referral_commissions"
      ADD CONSTRAINT "referral_commissions_reversal_consistency_check"
      CHECK ("status" <> 'reversed' OR "reversed_at" IS NOT NULL) NOT VALID;
  END IF;
END $$;