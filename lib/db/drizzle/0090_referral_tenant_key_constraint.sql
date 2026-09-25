-- PostgreSQL foreign keys to (tenant_id, id) require a UNIQUE constraint on
-- the referenced columns. A unique index is not sufficient for the
-- publish-time schema diff used by this project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'referrals'::regclass
      AND conname = 'referrals_tenant_id_unique'
  ) THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "referrals_tenant_id_unique"
      UNIQUE USING INDEX "referrals_tenant_id_unique";
  END IF;
END $$;