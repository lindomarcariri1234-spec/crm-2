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
