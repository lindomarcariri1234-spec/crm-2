-- Referral integrity constraints.
--
-- The referral tables are currently empty in development and the audit found no
-- orphaned rows in the related tables. Constraints are still added NOT VALID so
-- production legacy rows are not rewritten or blocked during deployment; new
-- writes are checked immediately. Existing data can be validated after a
-- production-specific audit.

CREATE INDEX IF NOT EXISTS "referrals_tenant_created_idx"
  ON "referrals" USING btree ("tenant_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_tenant_id_unique"
  ON "referrals" USING btree ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "referrals_tenant_status_expires_idx"
  ON "referrals" USING btree ("tenant_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "referrals_tenant_reservation_idx"
  ON "referrals" USING btree ("tenant_id", "reservation_id");
CREATE INDEX IF NOT EXISTS "referrals_tenant_code_idx"
  ON "referrals" USING btree ("tenant_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "referral_tracking_tenant_cookie_unique"
  ON "referral_tracking" USING btree ("tenant_id", "cookie_id");
CREATE INDEX IF NOT EXISTS "referral_tracking_tenant_code_idx"
  ON "referral_tracking" USING btree ("tenant_id", "referral_code");
CREATE INDEX IF NOT EXISTS "email_logs_tenant_referral_idx"
  ON "email_logs" USING btree ("tenant_id", "referral_id", "created_at");

DO $$
BEGIN
  ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id")
    ON DELETE SET NULL NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_bonus_reversals"
    ADD CONSTRAINT "referral_bonus_reversals_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_bonus_reversals"
    ADD CONSTRAINT "referral_bonus_reversals_referral_id_fkey"
    FOREIGN KEY ("tenant_id", "referral_id") REFERENCES "referrals" ("tenant_id", "id")
    ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_tracking"
    ADD CONSTRAINT "referral_tracking_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_settings"
    ADD CONSTRAINT "referral_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_campaigns"
    ADD CONSTRAINT "referral_campaigns_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_commissions"
    ADD CONSTRAINT "referral_commissions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_commissions"
    ADD CONSTRAINT "referral_commissions_referral_id_fkey"
    FOREIGN KEY ("tenant_id", "referral_id") REFERENCES "referrals" ("tenant_id", "id")
    ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "referral_attempt_logs"
    ADD CONSTRAINT "referral_attempt_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "email_logs"
    ADD CONSTRAINT "email_logs_referral_id_fkey"
    FOREIGN KEY ("referral_id") REFERENCES "referrals" ("id")
    ON DELETE SET NULL NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_status_check') THEN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_status_check"
      CHECK ("status" IN ('pending', 'completed', 'converted', 'expired', 'reversed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_nonnegative_amounts_check') THEN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_nonnegative_amounts_check"
      CHECK (
        "bonus_amount" >= 0
        AND "discount_value" >= 0
        AND ("discount_amount" IS NULL OR "discount_amount" >= 0)
        AND ("bonus_credit_used_amount" IS NULL OR "bonus_credit_used_amount" >= 0)
        AND "visits_count" >= 0
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_bonus_payment_consistency_check') THEN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_bonus_payment_consistency_check"
      CHECK (
        ("bonus_paid" = false AND "bonus_paid_at" IS NULL)
        OR ("bonus_paid" = true AND "bonus_paid_at" IS NOT NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_conversion_consistency_check') THEN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_conversion_consistency_check"
      CHECK (
        ("status" IN ('completed', 'converted', 'reversed') AND "converted_at" IS NOT NULL)
        OR ("status" IN ('pending', 'expired') AND "converted_at" IS NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_reversal_consistency_check') THEN
    ALTER TABLE "referrals" ADD CONSTRAINT "referrals_reversal_consistency_check"
      CHECK ("status" <> 'reversed' OR "reversal_at" IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_bonus_reversals_positive_amount_check') THEN
    ALTER TABLE "referral_bonus_reversals" ADD CONSTRAINT "referral_bonus_reversals_positive_amount_check"
      CHECK ("amount" > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_tracking_nonnegative_visits_check') THEN
    ALTER TABLE "referral_tracking" ADD CONSTRAINT "referral_tracking_nonnegative_visits_check"
      CHECK ("visits_count" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_tracking_conversion_consistency_check') THEN
    ALTER TABLE "referral_tracking" ADD CONSTRAINT "referral_tracking_conversion_consistency_check"
      CHECK (
        ("converted" = false AND "converted_at" IS NULL)
        OR ("converted" = true AND "converted_at" IS NOT NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_campaigns_nonnegative_values_check') THEN
    ALTER TABLE "referral_campaigns" ADD CONSTRAINT "referral_campaigns_nonnegative_values_check"
      CHECK (
        ("conversion_cap" IS NULL OR "conversion_cap" > 0)
        AND ("budget_amount" IS NULL OR "budget_amount" >= 0)
        AND "commission_value" >= 0
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_nonnegative_amount_check') THEN
    ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_nonnegative_amount_check"
      CHECK ("amount" >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_status_check') THEN
    ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_status_check"
      CHECK ("status" IN ('pending', 'approved', 'paid', 'reversed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_pending_payment_check') THEN
    ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_pending_payment_check"
      CHECK ("status" NOT IN ('pending', 'approved') OR "paid_at" IS NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_commissions_reversal_consistency_check') THEN
    ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_reversal_consistency_check"
      CHECK ("status" <> 'reversed' OR "reversed_at" IS NOT NULL) NOT VALID;
  END IF;
END $$;