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
Applying the backup's "agência" section must never touch identity/plan/limit columns (id, slug, plan, status, seat limits) — only an explicit allowlist of branding/settings fields. The source installation's tenant id is informational and is never written. Cross-installation restores identify the same logical agency by a stable matching CNPJ, email, or slug; every query and write remains scoped to the authenticated destination tenant.

**Why:** internal tenant ids legitimately change when an agency migrates between VisiteCRM installations, so equality on that implementation detail blocks valid restores while adding no write-scope protection.

**How to apply:** validate logical identity before starting the transaction, show source and destination agency names in confirmation, then ignore all source tenant ids during persistence and derive ownership exclusively from the authenticated user.

## Whole-request idempotency vs per-row idempotency are different layers
A `(tenantId, idempotencyKey)`-unique batch record stores the full computed report and replays it verbatim on a repeated request with the same key (409 if the same key arrives with a different file hash). This is separate from the per-row ledger dedup, which is what makes a *second, independent* upload of the same exported file (different idempotency key, e.g. a fresh browser session) still report "already existed" per row instead of duplicating — both layers matter because a user re-uploading later has no way to reuse the original idempotency key.

## Natural-key collisions must become ledger mappings, not row errors
When a destination tenant already contains the same business entity under a different source id, importers should find it by a tenant-scoped natural key, map the backup id to that existing row in the ledger, and report a skip/reuse. This lets dependent rows continue remapping correctly during partial restores.

**Why:** the source-id ledger alone cannot recognize equivalent rows created by an earlier partial restore or live synchronization. Treating expected unique-key collisions as row errors commits an apparently successful but incomplete restore.

**How to apply:** for each imported table with a unique business key, reconcile before insert. Only reuse keys that identify the same tenant-owned entity unambiguously; otherwise fail clearly or skip with an explicit report rather than retaining stale source ids.

See also: [Tenant backup/export design decisions](tenant-backup-export-pattern.md) for the export side, and [Per-row SAVEPOINT for continue-on-error import loops](postgres-per-row-savepoint.md) for the transaction mechanics this relies on.
