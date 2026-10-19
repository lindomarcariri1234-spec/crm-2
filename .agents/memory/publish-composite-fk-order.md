---
name: Publish schema vs. Drizzle migration ordering
description: Replit Publish applies schema diffs independently of the app's Drizzle startup migration ledger.
---

Replit Publish applies development-to-production schema diffs independently of the app's `drizzle.__drizzle_migrations` ledger. A publish can create a table, index, or constraint while the ledger remains at the previous migration; API startup then replays the pending migration and can fail on the already-existing object. A zero-diff publish result confirms schema shape, not that the migration ledger caught up.

For composite foreign keys, the referenced column tuple must already have a unique constraint on production. A standalone unique index in development may not appear in the publish diff. Replacing it with a table-level `UNIQUE` constraint makes the addition visible, but the diff may still order that constraint after the foreign key, so a one-pass publish can fail.

**Why:** Production inspection showed that Publish could leave newly-created objects in place while the Drizzle ledger stayed on the prior migration. The API then failed before serving, even though the next schema diff was empty. A prior composite-FK rollout also showed that Publish statement ordering can fail before later constraints are applied.

**How to apply:** After a publish migration failure, inspect the production catalog and Drizzle ledger separately; do not assume a retry will record the migration. Keep one coherent owner for production schema application, and do not write production migration metadata through the read-only replica. For FK-order issues, publish required unique constraints first, then add dependent composite foreign keys in a later publish; verify keys are unique and avoid table-truncation options.
