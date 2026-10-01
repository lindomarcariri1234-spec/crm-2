---
name: Clerk publication smoke authentication
description: The safe production-auth pattern for CI checks of protected published routes.
---

For production smoke tests that must visit protected Clerk routes, create a short-lived, single-use sign-in token for each dedicated role account with Clerk's Backend API. Open Clerk's returned Account Portal URL in an isolated browser, redirect back to the published app, and verify both `window.Clerk.user.id` and `window.Clerk.session.id` before checking protected routes. Keep account IDs as CI variables and the Clerk backend key as a CI secret. Revoke the active session after the check; if the token was never consumed, revoke the token instead.

Do not use human browser cookies or copied Authorization headers for this flow. `testClerkAuth` is for the app's Clerk e2e test setup, not authentication against the published Clerk instance.

**Why:** Long-lived browser credentials require manual rotation and expose reusable sessions in CI. A one-use token avoids that rotation and confirms the real published Clerk session and role-specific route behavior.

**How to apply:** Use this pattern for production browser smoke checks that need signed-in state. Confirm the deployed Clerk Account Portal accepts the app redirect and ensure interruption-safe cleanup is considered separately from normal completion cleanup.