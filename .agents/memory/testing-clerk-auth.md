---
name: Clerk e2e testing flag
description: runTest against this Clerk-protected app needs testClerkAuth:true or it hits Clerk's real sign-up UI and a Cloudflare bot challenge and cannot log in.
---

When using the `testing` skill's `runTest` on VisiteCRM (Clerk auth), you MUST pass `testClerkAuth: true` in the call. The `[Clerk Auth] Sign in as {...}` step only works programmatically when this flag is set.

**Why:** Without the flag, the testing agent tries the real Clerk sign-in/sign-up UI, which is gated by a Cloudflare "Verify you are human" challenge that Playwright can't pass (checkbox not exposed) → test returns `unable`. There was also a transient `failed_to_load_clerk_js` (proxied `/api/__clerk`) right after an api-server restart — retry/reload handles that.

**How to apply:** `runTest({ testClerkAuth: true, testPlan, relevantTechnicalDocumentation })`. To reach a role-gated agency page (e.g. `/insights`, RoleGate AGENCY_ROLES), after sign-in add a `[DB]` step: `UPDATE users SET tenant_id=(SELECT id FROM tenants WHERE slug='demo-agencia'), role='agencia' WHERE email='<login_email>'`, then reload the page so `useGetMe` refetches the role/tenant. `demo-agencia` is the seeded tenant with trips/reservations/clients.
