---
name: Tenant backup/export design decisions
description: Durable decisions behind a full-agency JSON backup export — credential scrubbing scope, tenant-isolation testing, and how "complete" is judged.
---

## Credential scrubbing must cover authorization tokens, not just login secrets
A "no credentials in the export" requirement is not satisfied by excluding known secret *tables* (OAuth tokens, payment-gateway keys) — ordinary business tables can carry a value that grants access on its own, without any other authentication, e.g. a device push token, or a client-supplied idempotency/replay key that an endpoint accepts as sole proof of ownership to return the underlying record.

**How to apply:** for every included table, check not just for token/secret/key/password/hash-shaped columns but also for any column an existing endpoint accepts as a lookup key with no other auth (idempotency keys, confirmation/unsubscribe tokens, invite tokens). If a value alone is enough to fetch or replay a record elsewhere in the app, sanitize it out of the export.

## Testing tenant isolation on a route that queries many tables
A mock keyed by call order/count is fragile when one route queries dozens of tables — any reordering silently breaks the test's coverage without failing it.

**How to apply:** prefer a mock that re-applies the same filter condition the code actually passed (rather than trusting the condition was correct), so two tenants' rows can coexist in one fixture set and cross-tenant leakage fails as a real assertion.

## A "complete backup" requirement means audit the whole schema, not the task's example list
A task description's bullet list of entity groups reads as bounded scope, but a reviewer judging "is this a *complete* export" treats it as illustrative, not exhaustive — every table carrying the tenant's own identifier is in scope unless there's a stated reason to exclude it, including tables with no single-column id (e.g. a composite-key counter row) that don't fit an existing streaming helper's assumptions.

**How to apply:** grep the entire schema tree for every table with a tenant-identifying column (directly or via a parent), not just the ones named in the spec. Decide include/exclude per table with a stated reason (e.g. exclude genuine bearer-credential tables, exclude another subsystem's own login-bearing table, exclude the tenant's platform/billing relationship with the product itself if the task's scope says so). Cross-reference foreign keys inside already-included tables — an unresolved reference to an excluded table is itself a completeness gap.
