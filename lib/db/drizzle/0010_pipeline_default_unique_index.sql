-- Fix for duplicate "Pipeline Principal" rows per tenant.
--
-- Root cause: ensureDefaultPipeline checked pipeline_stages for existence but
-- created rows in pipelines — two concurrent GET /pipelines requests could both
-- see "no stages" and each create a full default pipeline + stage set.
--
-- This migration:
--   1. Collapses any existing duplicate default pipelines per tenant: picks the
--      oldest as canonical, remaps deals from extra-pipeline stages to the
--      canonical stage with the same name (or the canonical's first stage as
--      fallback), then deletes the extras (cascade removes their stages).
--   2. Adds a partial unique index so two default pipelines can never coexist
--      again — the INSERT in ensureDefaultPipeline uses ON CONFLICT DO NOTHING
--      to safely absorb races.
--
-- Idempotent: the DO block is a no-op when no duplicates exist; IF NOT EXISTS
-- guards the index. Safe on both empty and already-migrated databases.

DO $$
DECLARE
  tenant_rec RECORD;
  extra_rec  RECORD;
  canonical_id      TEXT;
  fallback_stage_id TEXT;
BEGIN
  -- Only target tenants with more than one is_default=true pipeline.
  -- Non-default pipelines legitimately created by users are NOT touched.
  FOR tenant_rec IN
    SELECT tenant_id
      FROM pipelines
     WHERE is_default = true
     GROUP BY tenant_id
    HAVING count(*) > 1
  LOOP
    -- Canonical = oldest is_default=true pipeline for this tenant.
    SELECT id INTO canonical_id
      FROM pipelines
     WHERE tenant_id = tenant_rec.tenant_id
       AND is_default = true
     ORDER BY created_at ASC
     LIMIT 1;

    -- Fallback stage: lowest-order stage in the canonical pipeline.
    SELECT id INTO fallback_stage_id
      FROM pipeline_stages
     WHERE pipeline_id = canonical_id
     ORDER BY "order" ASC
     LIMIT 1;

    -- Process every extra is_default=true pipeline (not the canonical).
    FOR extra_rec IN
      SELECT id FROM pipelines
       WHERE tenant_id = tenant_rec.tenant_id
         AND is_default = true
         AND id != canonical_id
    LOOP
      -- Remap deals whose stage belongs to the extra pipeline.
      -- Try to find a same-named stage in the canonical pipeline; fall back to
      -- the canonical's first stage if no name match.
      UPDATE deals d
         SET stage_id = COALESCE(
               (SELECT cs.id
                  FROM pipeline_stages cs
                 WHERE cs.pipeline_id = canonical_id
                   AND cs.name = (SELECT es.name
                                    FROM pipeline_stages es
                                   WHERE es.id = d.stage_id)
                 LIMIT 1),
               fallback_stage_id
             )
       WHERE d.stage_id IN (
               SELECT id FROM pipeline_stages WHERE pipeline_id = extra_rec.id
             );

      -- Delete extra pipeline; pipeline_stages rows cascade-delete automatically.
      DELETE FROM pipelines WHERE id = extra_rec.id;
    END LOOP;

    -- Ensure canonical is the one marked as default.
    UPDATE pipelines SET is_default = true WHERE id = canonical_id;
  END LOOP;
END $$;

-- Partial unique index: at most one default pipeline per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS pipelines_one_default_per_tenant_idx
  ON pipelines (tenant_id)
  WHERE is_default = true;
