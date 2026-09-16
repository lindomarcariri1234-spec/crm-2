---
name: Manual table migration snapshots
description: Hand-written migrations that add tables need a later consolidated Drizzle snapshot for live schema verification
---

When a hand-written incremental migration adds a table, keep the original migration immutable and create a later consolidated Drizzle snapshot with a no-op journal entry if the live-schema verifier compares against the latest snapshot.

**Why:** The verifier applies incremental ADD COLUMN statements but does not infer newly created tables. Without the consolidated snapshot, a correctly migrated database is reported as having unexpected live columns.

**How to apply:** Do not add later columns back into the table-creation migration. Put them in their own migration, refresh the current snapshot, and make the snapshot-sync migration a no-op so fresh databases still execute the original table migration exactly once.