---
name: Published chunk verification
description: Design rule for checking code-split frontend assets in the published environment.
---

The publication smoke check can validate Vite code-split chunks without adding a browser dependency: request each route document, follow same-origin JavaScript imports and Vite chunk-map references recursively, and require successful JavaScript content types. Protected route checks must receive a short-lived test session through an environment-provided `Cookie` or `Authorization` header.

**Why:** The failure mode is an HTML document or stale/missing asset served at a JavaScript URL. Recursive published-asset checks catch this at the deployed origin while avoiding hard-coded credentials and the maintenance cost of shipping a browser binary in CI.

**How to apply:** Keep public and protected routes in the same check, include the route name in every asset failure, and never print or commit the authentication header. For PRs, validate the exact local build with a loopback-only chunk crawl plus simulated-role route-gate tests; keep the real Clerk browser smoke restricted to trusted main/manual runs.

For PR verification, do not authenticate against a Vercel preview that rewrites API/assets to production or expose production Clerk sessions to PR code. The local built-chunk mode must reject non-loopback URLs.

**Why:** a preview can reach production data, and code under review must not receive credentials or sessions it could exfiltrate.

**How to apply:** use the local build and simulated identities for required PR checks; use one-use Clerk tokens only for trusted publication smoke runs.

On GitHub-hosted Ubuntu runners, installing `chromium` through apt can select Canonical's Snap wrapper and stall headless startup even when Google Chrome is already available. In GitHub Actions, prefer the runner-installed Chrome before Chromium while preserving an explicit `CHROMIUM_PATH` override.

**Why:** The Snap wrapper caused the published chunk check to time out before opening a page target; the runner's existing Chrome starts normally.

**How to apply:** use the `GITHUB_ACTIONS` environment to order browser candidates for trusted CI, and keep Replit/local browser selection unchanged.

The Replit workspace may have the Playwright package without the matching browser binary in its cache. The screenshot service uses a separate browser, so successful visual captures do not prove a script-spawned Chromium/CDP browser can start.

**Why:** Local Playwright launch attempts can fail on a missing executable even when the app preview renders correctly.

**How to apply:** use screenshots to verify static rendering; treat executable-browser smoke checks as locally unverified until a browser binary is available, and rely on CI for that check.
