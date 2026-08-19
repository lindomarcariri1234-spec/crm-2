#!/bin/bash
set -e
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/scripts seed:plans

# ── Static schema-drift validation ──────────────────────────────────────────
# Catches columns/tables added to the Drizzle schema without a corresponding
# incremental migration (the silent cause of 500 errors when a required column
# is missing from the live DB after a merge).
#
#   check            — migration-file hashes are consistent with _journal.json
#   validate-coverage — every ADD COLUMN migration is reflected in the squash baseline
#   validate-columns  — every snapshot column has a corresponding ADD COLUMN migration
#   validate-tables   — every table/column in baseline is explained by a migration
pnpm --filter @workspace/db run check
pnpm --filter @workspace/db run validate-coverage
pnpm --filter @workspace/db run validate-columns
pnpm --filter @workspace/db run validate-tables

# ── Live DB column verification ──────────────────────────────────────────────
# Connects to the actual database and confirms that every table + column
# defined in the latest Drizzle snapshot exists in information_schema.columns.
#
# This catches the case the static checks CANNOT detect: when the Drizzle
# migrations tracking table (__drizzle_migrations) gets out of sync with the
# real DB state, e.g. a migration marked "applied" without actually executing
# the ALTER TABLE. Without this check, the missing column causes 500 crashes
# on every request that touches it (root cause of the prefix_locked outage).
pnpm --filter @workspace/db run verify-db
