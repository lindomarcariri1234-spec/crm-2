-- Classify legacy referral-reversal email logs without changing existing rows.
-- New reversal deliveries persist this type directly.
UPDATE "email_logs"
SET "notification_type" = 'reversed'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE 'Atualização sobre sua indicação%';