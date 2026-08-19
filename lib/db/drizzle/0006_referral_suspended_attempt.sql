-- Add column to track the last time a customer tried to use a suspended referral code
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "referral_suspended_attempt_at" TIMESTAMPTZ;
