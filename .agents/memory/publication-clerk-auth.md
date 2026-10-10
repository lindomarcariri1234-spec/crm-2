---
name: Clerk publication smoke authentication
description: The safe production-auth pattern for CI checks of protected published routes.
---

For production smoke tests that must visit protected Clerk routes, create a short-lived, single-use sign-in token for each dedicated role account with Clerk's Backend API. On the published app origin, redeem it through ClerkJS's documented `ticket` strategy, call `setActive()` with the created session ID, and verify both `window.Clerk.user.id` and `window.Clerk.session.id` before checking protected routes. Keep account IDs as CI variables and the Clerk backend key as a CI secret. Revoke the active session after the check; if the token was never consumed, revoke the token instead.

Do not use human browser cookies or copied Authorization headers for this flow. `testClerkAuth` is for the app's Clerk e2e test setup, not authentication against the published Clerk instance.

**Why:** Long-lived browser credentials require manual rotation and expose reusable sessions in CI. A one-use token avoids that rotation and confirms the real published Clerk session and role-specific route behavior.

**How to apply:** Use this pattern for production browser smoke checks that need signed-in state. Use the Clerk Frontend API ticket strategy from an initialized app-origin session so the Account Portal is not required; ensure interruption-safe cleanup is considered separately from normal completion cleanup.

### Cloudflare challenges during automated Clerk sign-in

The published Clerk Account Portal at `accounts.visitecrm.com` returned a Cloudflare “Just a moment” interstitial with HTTP 403 to automated publication verification, even while the storefront version marker and health check passed. The browser-based one-use ticket flow avoids this external portal.

**Why:** Redirecting a CI browser through the branded Account Portal can trigger anti-bot protection even when the app itself is available.

**How to apply:** Prefer the documented ClerkJS ticket strategy on the app origin; do not weaken authenticated coverage or treat a challenged portal as a successful sign-in.

### Protected-route reloads and cached assets

After a full route reload, Clerk can briefly expose no active user/session while its app-origin session rehydrates. The browser can also report HTTP 304 for JavaScript assets it already has cached; these responses are valid only when the MIME type is JavaScript and the protected page still renders its expected content.

**Why:** The first production run after ticket redemption exposed both normal startup/cache behavior as false smoke-test failures, despite the app and health marker being available.

**How to apply:** Wait a bounded interval for the exact expected Clerk user and session to return after route navigation; continue failing on redirects or identity mismatches. Accept cached 304 assets only in browser-observed requests and keep validating page content.
