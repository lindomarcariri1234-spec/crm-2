---
name: Clerk e2e testing flag
description: runTest against this Clerk-protected app needs testClerkAuth:true or it hits Clerk's real sign-up UI and a Cloudflare bot challenge and cannot log in.
---

When using the `testing` skill's `runTest` on VisiteCRM (Clerk auth), pass `testClerkAuth: true`. The `[Clerk Auth] Sign in as {...}` step only works programmatically when this flag is set. Replit-managed Clerk registers preview redirect URLs automatically: do not manually allowlist a transient `replit.dev` host. The Vite build must map the active `CLERK_PUBLISHABLE_KEY` to the frontend (without a hard-coded fallback), so the preview uses the managed development tenant.

**Why:** Without the flag, the testing agent tries the real Clerk sign-in/sign-up UI, which is gated by a Cloudflare "Verify you are human" challenge that Playwright can't pass (checkbox not exposed) → test returns `unable`. A stale hard-coded key can point a preview at a different Clerk instance, which does not know the current preview redirect URL and returns `form_param_value_invalid`. There was also a transient `failed_to_load_clerk_js` (proxied `/api/__clerk`) right after an api-server restart — retry/reload handles that.

**How to apply:** `runTest({ testClerkAuth: true, testPlan, relevantTechnicalDocumentation })`. If test-session injection returns 422 for `redirect_url`, first confirm the Vite build receives `CLERK_PUBLISHABLE_KEY`; do not add a temporary preview URL in Clerk. To reach a role-gated agency page (e.g. `/insights`, RoleGate AGENCY_ROLES), after sign-in add a `[DB]` step: `UPDATE users SET tenant_id=(SELECT id FROM tenants WHERE slug='demo-agencia'), role='agencia' WHERE email='<login_email>'`, then reload the page so `useGetMe` refetches the role/tenant. `demo-agencia` is the seeded tenant with trips/reservations/clients.
