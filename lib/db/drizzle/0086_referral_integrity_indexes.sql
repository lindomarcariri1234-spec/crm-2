-- Referral operational indexes and tenant-scoped tracking identity.
-- Existing tracking rows remain valid; the old global cookie uniqueness is
-- replaced by the correct tenant + cookie boundary.
ALTER TABLE "referral_tracking"
  DROP CONSTRAINT IF EXISTS "referral_tracking_cookie_id_unique";
DROP INDEX IF EXISTS "referral_tracking_cookie_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "referral_tracking_tenant_cookie_unique"
  ON "referral_tracking" USING btree ("tenant_id", "cookie_id");
CREATE INDEX IF NOT EXISTS "referral_tracking_tenant_code_idx"
  ON "referral_tracking" USING btree ("tenant_id", "referral_code");

CREATE INDEX IF NOT EXISTS "referrals_tenant_created_idx"
  ON "referrals" USING btree ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "referrals_tenant_status_expires_idx"
  ON "referrals" USING btree ("tenant_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "referrals_tenant_reservation_idx"
  ON "referrals" USING btree ("tenant_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "referrals_tenant_code_idx"
  ON "referrals" USING btree ("tenant_id", "code");

CREATE INDEX IF NOT EXISTS "email_logs_tenant_referral_idx"
  ON "email_logs" USING btree ("tenant_id", "referral_id", "created_at");