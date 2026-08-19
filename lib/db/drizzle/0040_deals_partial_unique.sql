-- Migration 0040: partial unique index on open deals to prevent duplicates
--
-- Adds a database-level guard ensuring at most ONE open deal exists for any
-- given (client_id, trip_id, tenant_id). The index is PARTIAL (WHERE status='open')
-- so it only affects active deals — a closed deal for the same client+trip does NOT
-- violate uniqueness.
--
-- The name is "pipeline_deal_dup_guard" so it can be referenced in tests, logging,
-- and any retry logic that needs to detect and surface the constraint.
--
-- This is idempotent: IF NOT EXISTS prevents failure on databases where the index
-- may have been added manually during incident response.
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_deal_dup_guard"
  ON deals (client_id, trip_id, tenant_id)
  WHERE status = 'open';
