---
name: Campaign bounce backfill performance
description: Performance tradeoff and migration-history guardrails for historical campaign bounce classification.
---

The historical classification query benefits from a partial `outbound_deliveries` index limited to Resend email rows with `permanent` or `temporary` bounce types, keyed by tenant, outbound message, and bounce type. Keep the partial predicate aligned with the migration filters.

**Why:** On a disposable PostgreSQL fixture with 1,000,000 messages/deliveries and about 1% eligible bounce rows, the classification update took about 2.97 seconds with existing indexes and 1.38 seconds with the selective partial index. Rebuilding campaign totals took about 0.17 seconds in the same fixture, so it did not justify another index.

**How to apply:** Re-measure with a representative ledger if query filters or joins change. Confirm a migration has not been applied before editing its SQL; once recorded in a deployment, keep it immutable and use an append-only migration for later index changes.
