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
- Treat `0000_squash_baseline` as an immutable historical snapshot. Put future
  schema changes only in new incremental migrations; fresh databases replay the
  baseline and then every later migration. Never rewrite the baseline after a
  database may have applied it. Do not change the baseline's `when`.
- A truly empty DB never occurs in normal Replit use (checkpoints carry schema
  forward); to test fresh-rebuild, `CREATE DATABASE` a throwaway DB and point
  `DATABASE_URL` at it (build URL via bash param-expansion, don't print secret).

**Coverage-validator caveat:** the table validator only recognizes the first
`ADD COLUMN` in a grouped `ALTER TABLE` statement. When several fields are
added at once, use one `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement per
column (or an idempotent coverage migration) and run `validate-coverage` plus
`validate-tables` before merging.

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

**Watermark, not just previous entry:** an existing database can have a migration
watermark newer than both the current clock and the checked-in journal. A new
migration whose `when` is below that database watermark is silently skipped on
already-migrated DBs even if it clears the journal's previous entry. The journal
ordering test guards the checked-in running maximum, but it cannot inspect every
database's applied watermark.

**How to apply:**
- When hand-writing a migration + journal entry, set its `when` strictly greater
  than BOTH the previous entry and the latest applied migration timestamp in
  the target development database. Do not assume the latest journal entry is the
  database watermark; verify `drizzle.__drizzle_migrations` if boot reports
  success but the new table or column is absent. The MEMORY entry
  "manual-migration" covers the write-SQL + update-journal flow.

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

# Reconciling columns from a later published branch

When the checked-out schema is behind a published branch and live databases
already contain the later columns, inspect the original migration SQL and live
values before restoring the schema. Reconcile with a new migration using
idempotent additive DDL; do not replay historical backfills or merge unrelated
branch history. Preserve verified indexes and foreign-key behavior.

**Why:** Existing deployments may contain non-null values written by historical
backfills. Re-running an old `UPDATE` can misclassify or overwrite populated
data, while a newer branch may have migration tags that conflict with the
current squashed journal.

**How to apply:** Read-only query the relevant development and production
columns, indexes, constraints, value distributions, and migration watermarks.
Choose a unique migration tag and a timestamp above both active watermarks.
Use `IF NOT EXISTS` for additive objects and include data updates only when
separately justified and explicitly scoped.
