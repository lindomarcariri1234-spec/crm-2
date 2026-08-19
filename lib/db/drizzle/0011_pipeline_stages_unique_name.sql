-- Adds a unique index on pipeline_stages(pipeline_id, name) to prevent
-- duplicate stage names within a pipeline. This makes ON CONFLICT DO NOTHING
-- effective in ensureDefaultPipeline's stage creation loop, absorbing any
-- concurrent inserts from two racing GET /pipelines requests.
--
-- Idempotent: the DO block removes any existing duplicate stage names (keeping
-- the lowest-order row per (pipeline_id, name) pair) before the index is added,
-- so it is safe on databases that have duplicate stage rows from past races.
-- IF NOT EXISTS guards the index creation itself.

DO $$
BEGIN
  -- Remove duplicate stage rows (same name within the same pipeline).
  -- Keep the row with the lowest `order` value; use id as a tiebreaker.
  DELETE FROM pipeline_stages
  WHERE id NOT IN (
    SELECT DISTINCT ON (pipeline_id, name) id
      FROM pipeline_stages
     ORDER BY pipeline_id, name, "order" ASC, id ASC
  );
END $$;

-- Unique index: at most one stage with a given name per pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_pipeline_id_name_idx
  ON pipeline_stages (pipeline_id, name);
