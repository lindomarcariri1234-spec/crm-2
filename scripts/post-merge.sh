#!/bin/bash
set -euo pipefail

# Post-merge must reproduce the dependency tree committed in pnpm-lock.yaml.
pnpm install --frozen-lockfile

# Reconcile the development database before checking its schema. Both commands
# are idempotent: migrations only advance the journal and plan seeding never
# overwrites administrator-managed values.
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/scripts seed:plans

# ── Static schema-drift validation ──────────────────────────────────────────
# Catches columns/tables added to the Drizzle schema without a corresponding
# incremental migration (the silent cause of 500 errors when a required column
# is missing from the live DB after a merge).
#
#   check            — migration-file hashes are consistent with _journal.json
#   validate-coverage — reports ADD COLUMN migrations made after the immutable baseline
#   validate-columns  — every snapshot column has a corresponding ADD COLUMN migration
#   validate-tables   — every table/column in baseline is explained by a migration
pnpm --filter @workspace/db run check
pnpm --filter @workspace/db run validate-coverage
pnpm --filter @workspace/db run validate-columns
pnpm --filter @workspace/db run validate-tables

# Verify that migrations were applied to the actual database, not only recorded
# in Drizzle's journal. This prevents schema drift from surfacing as API 500s.
pnpm --filter @workspace/db run verify-db
