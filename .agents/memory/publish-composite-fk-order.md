---
name: Publish composite foreign-key order
description: Replit's schema diff can omit standalone unique indexes and order composite foreign keys before newly added unique constraints.
---

When adding a composite foreign key through Publish, the referenced column tuple must already have a unique constraint on the production target. A standalone unique index in development may not appear in the publish diff. Replacing it with a table-level `UNIQUE` constraint makes the addition visible, but the diff may still order that constraint after the foreign key, so a one-pass publish can fail. Also account for the API's journaled startup migrator: Publish may create a named constraint before the migration ledger catches up.

**Why:** The project had the required unique indexes in development, but none in production; the publish diff emitted the foreign keys first and failed before any later unique-constraint statements. On a staged retry, Publish created the constraints while the API's pending migration still attempted to attach the same indexes, preventing API startup.

**How to apply:** Inspect both catalogs and recompute the actual publish diff. If ordering is wrong, stage the supported Publish flow: publish only the unique constraints while retaining the existing simple foreign keys, then add the composite foreign keys in development and publish again. Ensure pending journal migrations skip already-present matching named constraints instead of adding them twice. Verify keys are unique and do not choose any table-truncation option.
