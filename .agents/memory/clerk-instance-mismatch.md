---
name: Clerk instance mismatch → 401
description: How mismatched Clerk publishable key (frontend) vs secret key (backend) causes silent 401 on all authenticated requests in production.
---

# Clerk instance mismatch → 401

## The rule
`CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` must belong to the **same** Clerk instance. Mixing keys from different instances (e.g. `pk_live_` from `clerk.visitecrm.pro` with a `sk_test_` from `eager-grackle-28.clerk.accounts.dev`) causes every token to be rejected with 401 — no error message on the Clerk side, just a silent auth failure.

**Why:** Clerk signs JWTs with the instance's private key; the backend verifies with the matching public key derived from the secret. Cross-instance tokens are cryptographically invalid.

**How to apply:**
- When investigating 401s, immediately check that `CLERK_PUBLISHABLE_KEY` prefix (`pk_live_` vs `pk_test_`) matches the `CLERK_SECRET_KEY` prefix (`sk_live_` vs `sk_test_`).
- In Replit, **secrets take precedence over env vars**. If a `pk_live_` env var exists alongside a `pk_test_` secret, the secret wins in some runtimes and the env var wins in others — delete the conflicting env var entirely.
- The diagnostic endpoint `GET /api/health/auth` returns the Clerk instance in use; compare against the frontend's `VITE_CLERK_PUBLISHABLE_KEY`.
