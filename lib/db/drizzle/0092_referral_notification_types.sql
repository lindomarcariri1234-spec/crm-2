-- Keep referral delivery status independent from translated or edited subjects.
ALTER TABLE "email_logs"
  ADD COLUMN IF NOT EXISTS "notification_type" text;

CREATE INDEX IF NOT EXISTS "email_logs_tenant_referral_type_idx"
  ON "email_logs" USING btree ("tenant_id", "referral_id", "notification_type", "created_at");

-- Backfill the referral notification types that can be identified safely from
-- the historical templates. New records are written by the stable event type.
UPDATE "email_logs"
SET "notification_type" = 'expiry_warning_7'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE '%7 dias%';

UPDATE "email_logs"
SET "notification_type" = 'expiry_warning_1'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE '%1 dia%';

UPDATE "email_logs"
SET "notification_type" = 'bonus_released'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE '%disponível para resgate%';

UPDATE "email_logs"
SET "notification_type" = 'bonus_paid'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE 'Seu bônus de indicação foi pago!%';

UPDATE "email_logs"
SET "notification_type" = 'converted'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE 'Sua indicação foi confirmada!%';

UPDATE "email_logs"
SET "notification_type" = 'expired'
WHERE "notification_type" IS NULL
  AND "referral_id" IS NOT NULL
  AND "subject" ILIKE 'Sua indicação expirou%';