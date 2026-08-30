---
name: Clerk social login
description: Social login for agency auth pages relies on Clerk environment configuration and native redirect-based components.
---

The agency sign-in and sign-up pages must use Clerk's native social buttons; provider availability is configured in each Clerk environment, not hard-coded in the client. Use `oauthFlow="redirect"` and a BASE_PATH-aware fallback so OAuth callbacks work reliably in proxied previews and published paths.

**Why:** The Clerk React components render enabled providers and handle consent, cancellation, and callback errors themselves. Redirect mode avoids popup/iframe completion issues while the existing `clerkId` sync remains the source of truth for deduplication and role routing.

**How to apply:** When changing agency auth, preserve Clerk's native `<SignIn>`/`<SignUp>` flow, keep provider credentials out of the repository, and test both `/sign-in` and `/sign-up` in the active Clerk development and production environments.