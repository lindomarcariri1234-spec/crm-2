---
name: Publish composite foreign-key order
description: Replit's schema diff can omit standalone unique indexes and order composite foreign keys before newly added unique constraints.
---

When adding a composite foreign key through Publish, the referenced column tuple must already have a unique constraint on the production target. A standalone unique index in development may not appear in the publish diff. Replacing it with a table-level `UNIQUE` constraint makes the addition visible, but the diff may still order that constraint after the foreign key, so a one-pass publish can fail.

**Why:** The project had the required unique indexes in development, but none in production; the publish diff emitted the foreign keys first and failed before any later unique-constraint statements.

**How to apply:** Inspect both catalogs and recompute the actual publish diff. If ordering is wrong, stage the supported Publish flow: publish only the unique constraints while retaining the existing simple foreign keys, then add the composite foreign keys in development and publish again. Verify keys are unique and do not choose any table-truncation option.
