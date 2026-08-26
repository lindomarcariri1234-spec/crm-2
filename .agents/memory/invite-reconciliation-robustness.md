---
name: Invite reconciliation robustness
description: Lessons from fixing a staff invite that stayed "pending" after the vendor logged in — root cause and the safety model used for the fix.
---

## Root cause pattern
Invite reconciliation in a `POST /users/me/sync`-style flow that only runs
`if (!existing.tenantId)` silently stops working the moment a user acquires
*any* tenantId before the real invite arrives — e.g. self-provisioning via an
onboarding "skip" flow that auto-creates a placeholder tenant. The user is
then permanently stuck as admin of an empty tenant, invisible to the agency
that actually invited them, with their invite stuck "pending" forever. This
class of bug does not throw errors or show up in logs — it just silently
returns empty tenant-scoped data forever.

**Why:** tenantId-null is not the only "not really onboarded yet" state; a
freshly self-provisioned placeholder tenant (sole member, zero real data) is
functionally the same state and needs the same reconciliation opportunity.

**How to apply:** when building invite/account-linking reconciliation, treat
"has a tenant but it's an unused placeholder" as a distinct case from "has no
tenant" and "has a real established tenant" — the first two should both allow
reconciliation, the third must never be touched.

## Safety model for reconciling an existing tenantId
Before overriding a user's current tenantId with a different pending invite's
tenant, require ALL of:
- current role is the self-provisioning default (e.g. agency-owner/admin) —
  never reconsider an already-provisioned staff member (vendedor/gerente) even
  if a stray invite happens to match their email.
- a matching pending, unexpired invite exists for a *different* tenant.
- the current tenant is verifiably unused: exactly one member and zero real
  business records (trips, in this app's case) in it.

Only when all hold, update tenantId+role and mark the invite accepted; log an
info line. Otherwise leave both tenants/invites untouched with a warn log.

**Why:** this is the only way to self-heal a real production account (whose
row you cannot edit directly, e.g. via a read-only prod DB) purely through
corrected app logic on its next login, without any risk of moving data for an
unrelated agency or vendor.

**How to apply:** the safety check now also covers clients, reservations, and
store activity — not just teammates/trips — so a placeholder tenant with
clients-but-no-trips is treated as "used" and never silently abandoned.

**Store row is not a usable "is used" signal:** onboarding auto-creates a
`stores` row (default name/slug/contact info) for every self-provisioned
tenant, so "does a store row exist for this tenant" is always true and can't
distinguish an untouched placeholder from a real one. Check the store's
*contents* instead — `storeProductsTable` (joined via `storesTable.id`, since
it has no `tenantId` column) and `storeOrdersTable` (has `tenantId` directly).
Coupons/reviews and store branding customization (logo, description, payment
methods) are not yet covered — see follow-up tasks if picking this up again.

## Email matching
Compare invite emails case/whitespace-insensitively (`lower(trim(email))`),
never with a bare `eq()`. A typo'd capital letter in an invite should not
permanently strand the invited user.

## Test-mock ripple effect
Adding extra `db.select` calls to an existing-user branch of a heavily-mocked
route (positional `mockLimit.mockResolvedValueOnce(...)` chains) breaks every
other test that reaches that branch, even if unrelated to the new feature —
audit and update each one's queued select sequence, not just the new tests.

## Access-check ordering vs. reconciliation
`checkTenantAccess` on the user's *current* tenant must never run before
invite reconciliation is attempted, or an expired/suspended self-provisioned
placeholder permanently locks out a user who has a valid pending invite to a
different, active tenant — reconciliation never gets a chance to run. Resolve
`winningInvite` first; only gate on the current tenant's access status when no
winning invite was found. This does not verify the *target* tenant's access
status before reconciling onto it — that gap self-corrects on the user's next
login (checkTenantAccess then runs against the new tenantId).
