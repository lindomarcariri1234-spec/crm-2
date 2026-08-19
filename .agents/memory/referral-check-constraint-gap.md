---
name: referral CHECK constraint not in baseline/schema
description: referrals_crm_requires_reservation_id exists in live DBs but is absent from Drizzle schema and squash baseline
---
The CHECK constraint `referrals_crm_requires_reservation_id`
(`CHECK (source IS DISTINCT FROM 'crm' OR reservation_id IS NOT NULL)`) is
present and correct in BOTH the development and production databases (verified
via pg_constraint). It was originally created by a raw-SQL migration (the old
0071) that got squashed away.

**Gap:** The constraint is NOT defined in the Drizzle schema
(`lib/db/src/schema/referrals.ts` — `source` is just a nullable text column with
no `.check()`), and it is NOT in `lib/db/drizzle/0000_squash_baseline.sql`
(the baseline only has FK constraints, no referrals CHECK). So a freshly-built
database (new env, local reset) would silently lack this safeguard, and there is
no migration to recreate it.

**Why it matters:** Live data integrity is currently fine, but the code path
that builds new databases has lost the constraint. Fixing requires adding it to
the schema as a table-level check AND/OR a new numbered idempotent migration
(idx 1+) so fresh builds get it.
