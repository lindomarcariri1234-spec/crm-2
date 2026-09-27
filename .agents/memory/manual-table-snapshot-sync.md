---
name: Manual table migration snapshots
description: Hand-written migrations that add tables need a later consolidated Drizzle snapshot for live schema verification
---

When a hand-written incremental migration adds a table, keep the original migration immutable. The live-schema verifier must include columns from both incremental ALTER TABLE statements and incremental CREATE TABLE statements; use a later consolidated snapshot only when the verifier cannot represent the table.

**Why:** Hand-written migrations may intentionally predate the latest Drizzle snapshot. Treating their tables as unknown creates false drift failures even when the migration ran correctly.

**How to apply:** Do not add later columns back into the table-creation migration. Put later changes in their own idempotent migration and keep drift parsing aware of post-snapshot tables.

When independently journaled branches leave two Drizzle snapshots with the same parent, keep the published snapshot chain and create a new terminal snapshot from the reconciled schema. A journaled no-op migration can anchor that snapshot only after every generated DDL statement is shown to be covered by already applied migrations or an equivalent live constraint.

**Why:** Replaying generated DDL after a content merge can recreate existing tables, columns, indexes, or foreign keys under new names, while keeping competing snapshots makes `drizzle-kit check` fail.

**How to apply:** Do not rewrite applied SQL or discard the published parent chain. Review the generated SQL against the migration history and read-only live schema, replace only duplicate DDL with a no-op marker, then confirm `schema-drift` and a second generate with no changes.