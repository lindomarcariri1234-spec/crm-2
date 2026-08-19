ALTER TABLE referral_settings ADD COLUMN IF NOT EXISTS bonus_validity_days integer NOT NULL DEFAULT 30;
