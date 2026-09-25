-- Retention deletes are always tenant-scoped and ordered by age. Keep the
-- operational cleanup bounded without changing or deleting historical rows.
CREATE INDEX IF NOT EXISTS "referral_attempt_logs_tenant_created_idx"
  ON "referral_attempt_logs" USING btree ("tenant_id", "created_at");