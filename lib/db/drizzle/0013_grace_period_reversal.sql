ALTER TABLE referral_settings ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 30;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reversal_at timestamptz;
