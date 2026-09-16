---
name: Manual table migration snapshots
description: Hand-written migrations that add tables need a later consolidated Drizzle snapshot for live schema verification
---

When a hand-written incremental migration adds a table, keep the original migration immutable. The live-schema verifier must include columns from both incremental ALTER TABLE statements and incremental CREATE TABLE statements; use a later consolidated snapshot only when the verifier cannot represent the table.

**Why:** Hand-written migrations may intentionally predate the latest Drizzle snapshot. Treating their tables as unknown creates false drift failures even when the migration ran correctly.

**How to apply:** Do not add later columns back into the table-creation migration. Put later changes in their own idempotent migration and keep drift parsing aware of post-snapshot tables.