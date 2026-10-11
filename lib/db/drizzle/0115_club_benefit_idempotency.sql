ALTER TABLE club_benefits
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS club_benefits_tenant_idempotency_key_unique
  ON club_benefits (tenant_id, idempotency_key);
