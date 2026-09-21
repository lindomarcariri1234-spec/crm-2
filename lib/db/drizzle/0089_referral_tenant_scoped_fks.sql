-- Prevent a commission or reversal from pointing at a referral in another
-- tenant. The referral primary key is globally unique, but that alone does not
-- enforce the tenant boundary represented by the child row.

CREATE UNIQUE INDEX IF NOT EXISTS "referrals_tenant_id_unique"
  ON "referrals" USING btree ("tenant_id", "id");

ALTER TABLE "referral_bonus_reversals"
  DROP CONSTRAINT IF EXISTS "referral_bonus_reversals_referral_id_fkey";

ALTER TABLE "referral_commissions"
  DROP CONSTRAINT IF EXISTS "referral_commissions_referral_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_bonus_reversals_tenant_referral_fkey') THEN
    ALTER TABLE "referral_bonus_reversals"
      ADD CONSTRAINT "referral_bonus_reversals_tenant_referral_fkey"
      FOREIGN KEY ("tenant_id", "referral_id")
      REFERENCES "referrals" ("tenant_id", "id")
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_tenant_referral_fkey') THEN
    ALTER TABLE "referral_commissions"
      ADD CONSTRAINT "referral_commissions_tenant_referral_fkey"
      FOREIGN KEY ("tenant_id", "referral_id")
      REFERENCES "referrals" ("tenant_id", "id")
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;