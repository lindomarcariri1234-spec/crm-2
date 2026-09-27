---
name: referral CHECK constraint not in baseline/schema
description: referrals_crm_requires_reservation_id exists in live DBs but is absent from Drizzle schema and squash baseline
---
The CHECK constraint `referrals_crm_requires_reservation_id`
(`CHECK (source IS DISTINCT FROM 'crm' OR reservation_id IS NOT NULL)`) is
present in live databases. It is absent from the Drizzle schema and the squash
baseline, but `0001_referrals_crm_check.sql` is journaled after the baseline and
recreates it idempotently on rebuilt databases.

**Why:** Schema generation or a future squash can omit an invariant that is
represented only by raw SQL. The corrective migration protects rebuilt
databases, but the TypeScript schema still does not describe the rule.

**How to apply:** Keep the journaled migration after the baseline, and preserve
the exception for product-only orders and pending invitations. If the schema is
later taught this CHECK directly, retain compatible migration behavior for
already-migrated databases.
