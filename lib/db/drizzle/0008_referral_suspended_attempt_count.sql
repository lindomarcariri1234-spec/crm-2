-- Track how many times a customer attempted to use a suspended referral code
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "referral_suspended_attempt_count" INTEGER NOT NULL DEFAULT 0;
