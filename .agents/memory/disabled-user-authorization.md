---
name: Disabled-user authorization
description: Cross-route policy and explicit exceptions for users disabled with the local activity flag.
---

**Rule:** An existing local user with `isActive=false` must receive a 403 authorization denial on protected application routes, even when a route skips tenant billing checks. Direct Clerk-authenticated routes and upload callbacks need their own activity gate. Optional financial operations must not treat an inactive account as authorized.

**Exceptions:** Keep self-service account deletion available to the account owner. Routes that intentionally support first-time provisioning may allow a Clerk identity with no local user row. Reactivation remains an explicit action by an active administrator.

**Why:** Disabling a staff account is intended to revoke application access, not merely hide the user from the team list. A valid Clerk session alone does not represent local authorization.

**How to apply:** When adding a route that reads Clerk identity directly, check local activity before protected reads or writes. A tenant billing-state bypass must not bypass user activity. Preserve deletion and onboarding behavior for identities without a local row.