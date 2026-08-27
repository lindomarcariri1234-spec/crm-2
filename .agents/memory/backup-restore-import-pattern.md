---
name: JSON backup restore/import design decisions
description: Companion to the backup EXPORT pattern — how a re-uploadable full-tenant JSON backup is imported idempotently, with FK remapping, global-uniqueness regeneration, and user-by-email matching (no credential recreation).
---

## Ledger-by-original-source-id is the dedup + remap mechanism
Every imported row gets a ledger entry keyed by `(tenantId, entityType, original-backup-id)` -> the newly-created row's id. This single structure solves two problems at once: re-running the same file (or a partially-imported file) looks up the ledger first and reports "already existed" instead of re-inserting, and any other row that references the old id (e.g. a reservation's `clientId`) resolves it through the ledger to get the *new* id after ids change on recreation.

**Why:** ids are always regenerated on import (never reuse the backup's own ids — they could collide with unrelated live rows), so every cross-entity FK reference in the backup must be re-pointed through this map, in dependency order (parent entities imported, and their ledger entries written, before dependents that reference them).

## Globally-unique business codes must be regenerated and collision-checked inline
Columns like a customer code, referral code, or voucher/QR code are unique *across the whole table*, not scoped to a tenant. A naive "copy the value from the backup" import can collide with a completely unrelated tenant's existing row. These must go through the same generator/collision-check the normal create path uses, executed inside the same per-row transaction scope that creates the row (see the per-row-savepoint note) — never precomputed outside the transaction, since two rows can't safely target the same regenerated code.

## Users are matched by email, never recreated
Backup rows referencing a user (e.g. a reservation's salesperson) are resolved by looking up an existing account in the *importing* tenant by lowercased/trimmed email. No login/credential is ever recreated (auth is external/Clerk). When no match exists, the reference falls back to the importer's own user id (for attribution-style references) or to `null` (for soft/optional references) — which fallback applies depends on whether the field is required for the row to make sense. Every fallback decision is recorded in the final report so the admin can see who wasn't matched.

## Agency-level import is UPDATE-only on an allowlist
Applying the backup's "agência" section must never touch identity/plan/limit columns (id, slug, plan, status, seat limits) — only an explicit allowlist of branding/settings fields. The backup's tenant id is used only to validate the file belongs to the importer's own tenant (reject on mismatch) — it never gets written anywhere.

## Whole-request idempotency vs per-row idempotency are different layers
A `(tenantId, idempotencyKey)`-unique batch record stores the full computed report and replays it verbatim on a repeated request with the same key (409 if the same key arrives with a different file hash). This is separate from the per-row ledger dedup, which is what makes a *second, independent* upload of the same exported file (different idempotency key, e.g. a fresh browser session) still report "already existed" per row instead of duplicating — both layers matter because a user re-uploading later has no way to reuse the original idempotency key.

See also: [Tenant backup/export design decisions](tenant-backup-export-pattern.md) for the export side, and [Per-row SAVEPOINT for continue-on-error import loops](postgres-per-row-savepoint.md) for the transaction mechanics this relies on.
