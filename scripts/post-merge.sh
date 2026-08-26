#!/bin/bash
set -euo pipefail

# Post-merge must reproduce the dependency tree committed in pnpm-lock.yaml.
pnpm install --frozen-lockfile

# Reconcile the development database before checking its schema. Both commands
# are idempotent: migrations only advance the journal and plan seeding never
# overwrites administrator-managed values.
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/scripts seed:plans

# Run the reproducible local static checks and then compare the live database
# directly through information_schema. This does not use Replit's database-diff
# endpoint and must remain after migrate so the real database is verified.
pnpm --filter @workspace/db run schema-drift
