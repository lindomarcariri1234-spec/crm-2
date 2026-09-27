---
name: Manual migration workflow
description: drizzle-kit is interactive so migrations must be created manually
---

drizzle-kit generate/push prompts interactively and cannot be run non-interactively from scripts.

**Correct workflow**:
1. Write the SQL file at `lib/db/drizzle/NNNN_<tag>.sql`
2. Add an entry to `lib/db/drizzle/meta/_journal.json` with the next idx (auto-increment from last entry), version "7", a timestamp, and the tag (matching the filename without .sql)
3. Run `pnpm --filter @workspace/db migrate` — this applies any unapplied entries from the journal

**Why**: The migrate command is non-interactive and reads the journal to determine what to apply. The generate command would overwrite the journal with drizzle's own snapshot.

**How to apply**: Check the last `idx` in `_journal.json` before writing a new migration. Next migration is last idx + 1.

**Rule for clean-database prerequisites:** Do not rewrite already-applied baseline or incremental SQL to fix a dependency on a table created later in the journal. Prepare the prerequisite from its original CREATE migration only when the public schema is genuinely empty, and keep command-line and application migration entry points aligned.

**Why:** A production database may already have recorded the historical migration hash; changing that history risks divergence or reapplying constraints. A populated database must never receive a fresh-install bootstrap.

**How to apply:** Verify both migration entry points on separate disposable empty databases, and confirm that preparation on a populated database does not create tables or change existing rows.

**Concurrency rule:** The shared migration pipeline must hold one session-level PostgreSQL advisory lock until the Drizzle runner finishes, for both the CLI and API startup paths.

**Why:** A transaction lock around prerequisite table creation ends before Drizzle applies the journal, leaving concurrent application and CLI starts free to race on the baseline and migration ledger.

**How to apply:** Route every migration entry point through the shared pipeline and test simultaneous CLI/API starts against a disposable empty database.

**Lock wait budget:** `MIGRATION_LOCK_TIMEOUT_MS` configures the maximum startup wait for both CLI and API migration paths; it must be a positive integer in milliseconds, defaulting to 120 seconds. A timeout occurs before schema preparation and journal application.

**Why:** PostgreSQL advisory locks otherwise wait without a bound, which can leave startup stuck when the process holding the lock stops progressing.

**How to apply:** Keep timeout validation and acquisition in the shared pipeline, and verify CLI plus runtime timeout paths leave the schema unchanged.

**Bounded wait implementation:** Apply PostgreSQL `lock_timeout` with `SET LOCAL` in a short transaction while acquiring the session-level migration lock. Commit that transaction before schema preparation; the session lock remains held through the migrator while the local timeout setting does not leak into the pool.

**Why:** A session-level lock is required across the separate Drizzle connection, but a session-scoped timeout setting could leak when the lock connection returns to the pool.

**How to apply:** Preserve the transaction boundary, translate lock-timeout SQLSTATE `55P03` to the actionable migration timeout error, and keep the session lock until the full journal runner ends.
