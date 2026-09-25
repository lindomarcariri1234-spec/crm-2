-- Replace the original NOT VALID tenant-scoped referral FKs with
-- immediately validated constraints. The distinct names let the publish-time
-- schema diff add the validated constraints before removing the legacy ones.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'referral_bonus_reversals'::regclass
      AND conname = 'referral_bonus_reversals_tenant_referral_validated_fkey'
  ) THEN
    ALTER TABLE "referral_bonus_reversals"
      ADD CONSTRAINT "referral_bonus_reversals_tenant_referral_validated_fkey"
      FOREIGN KEY ("tenant_id", "referral_id")
      REFERENCES "referrals" ("tenant_id", "id")
      ON DELETE RESTRICT;
  END IF;
  ALTER TABLE "referral_bonus_reversals"
    DROP CONSTRAINT IF EXISTS "referral_bonus_reversals_tenant_referral_fkey";
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'referral_commissions'::regclass
      AND conname = 'referral_commissions_tenant_referral_validated_fkey'
  ) THEN
    ALTER TABLE "referral_commissions"
      ADD CONSTRAINT "referral_commissions_tenant_referral_validated_fkey"
      FOREIGN KEY ("tenant_id", "referral_id")
      REFERENCES "referrals" ("tenant_id", "id")
      ON DELETE RESTRICT;
  END IF;
  ALTER TABLE "referral_commissions"
    DROP CONSTRAINT IF EXISTS "referral_commissions_tenant_referral_fkey";
END $$;