-- Adiciona coluna referral_code_status que foi omitida do squash baseline.
-- Idempotente: usa IF NOT EXISTS / EXCEPTION WHEN duplicate_object.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "referral_code_status" text NOT NULL DEFAULT 'active';

-- Garante que o CHECK constraint existe (migration 0005 também tenta, mas pode ter pulado).
DO $$
BEGIN
  ALTER TABLE "clients"
    ADD CONSTRAINT "clients_referral_code_status_check"
    CHECK ("referral_code_status" IN ('active', 'blocked', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
