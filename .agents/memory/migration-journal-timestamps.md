---
name: Migration journal timestamp ordering
description: Drizzle silently skips migrations whose _journal.json `when` is not newer than the last applied one; legacy chain squashed into one idempotent baseline
---

# History squashed into a single consolidated baseline

The legacy `0000`–`0072` chain could NOT rebuild a fresh database: 11 tables
(`email_logs`, `referral_settings`, `birthday_messages`, `calendar_events`,
`invites`, `platform_settings`, `referral_tracking`, `sales_goals`,
`trip_costs`, `usage_tracking`, `vehicle_layouts`) were only ever provisioned
via `drizzle-kit push`, never by a migration, so `migrate` hard-failed at `0015`
(`ALTER TABLE email_logs` on a non-existent table).

**Resolution:** squashed into one idempotent baseline `0000_squash_baseline`
(generated from current schema, then transformed: `CREATE TABLE/INDEX IF NOT
EXISTS` + `DO $$ … EXCEPTION WHEN duplicate_object $$` on every FK).

**Why a single baseline coexists safely with existing DBs:** the migrator reads
the single most-recently-applied migration once and only applies entries whose
`when` exceeds it. The baseline's `when` is set deliberately LOW
(`1745010000000`, below every existing DB watermark) so DBs with migration
history skip it, while empty DBs (no watermark) apply it. Verified: fresh DB →
93 tables; existing DB → skipped, untouched; idempotent on push-only DBs.

**How to apply going forward:**
- NEVER mutate `0000_squash_baseline` or its `when`. To change schema, edit
  `src/schema/` then `pnpm --filter @workspace/db generate` (new idx 1+).
- A truly empty DB never occurs in normal Replit use (checkpoints carry schema
  forward); to test fresh-rebuild, `CREATE DATABASE` a throwaway DB and point
  `DATABASE_URL` at it (build URL via bash param-expansion, don't print secret).

# Migration journal timestamps must strictly increase

Drizzle's node-postgres migrator applies entries from
`lib/db/drizzle/meta/_journal.json` in `when`-timestamp order and **silently
skips** any migration whose `when` is not greater than the most recent
already-applied migration. No error is raised — the migration just never runs.

**Why:** Migration 0071 (`referrals_crm_requires_reservation_id` CHECK
constraint) shipped with a `when` earlier than 0070's, so the migrator treated
it as already-applied and skipped it. `drizzle-kit migrate` reported "applied
successfully" while doing nothing. (It was later applied by other means — as of
the squash audit the constraint DOES exist in dev and prod.)

**Watermark, not just previous entry:** existing DBs carry a migration watermark
of ~`1.782e12` (the legacy chain's inflated timestamps), which is HIGHER than
`Date.now()` in 2026. A new migration whose `when` is below that watermark is
silently skipped on already-migrated DBs even though it clears the previous
journal entry. The corrective migration `0001_referrals_crm_check` deliberately
uses `when=1800000000000` (above the watermark) so it runs everywhere AND raises
the journal running-max so the guard test now also forces future migrations
above the watermark.

**How to apply:**
- When hand-writing a migration + journal entry, set its `when` strictly greater
  than BOTH the previous entry AND the ~1.78e12 DB watermark (not real epoch-now,
  which is currently lower). The MEMORY entry "manual-migration" covers the
  write-SQL + update-journal flow.

# A squash regenerated from schema TS silently drops manual-migration-only objects

A baseline generated from the Drizzle schema TS (via `drizzle-kit generate`)
omits any DB object that lives ONLY in a hand-written migration and is not
declared in `lib/db/src/schema/` — e.g. CHECK constraints not expressed via the
`check()` helper. The squash baseline (`0000_squash_baseline`) therefore lacked
`referrals_crm_requires_reservation_id`, so fresh DBs built from it missed a
data-integrity guard that existing DBs already had. Restored via idempotent
corrective migration `0001`.

**Why it matters:** `drizzle-kit generate` reporting "No schema changes" only
proves the baseline matches the schema TS — NOT that it matches a real database.
To validate a squash, diff a baseline-built throwaway DB against an existing DB
at the catalog level (`pg_tables`, `information_schema.columns`, `pg_indexes`,
`pg_constraint` via `pg_get_constraintdef`), not just `generate`.

**How to apply:** after any future squash/regeneration, run the catalog diff; any
object present in the existing DB but missing from the fresh build needs an
idempotent corrective migration (idx 1+, `when` above the watermark). The
durable fix for the root cause is to declare such constraints in the schema TS
so future regenerations keep them.

# Detecting silently-skipped / dropped migrations

- Symptom: `migrate` says success but the column/constraint is absent. Verify
  directly with psql against `information_schema` / `pg_constraint`, and check
  `drizzle.__drizzle_migrations` ordering.
- `pnpm --filter @workspace/db check` (schema drift) does NOT catch this — it
  compares schema files to migration SQL, not what's actually applied.
