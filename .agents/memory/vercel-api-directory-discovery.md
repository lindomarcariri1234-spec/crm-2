---
name: Vercel root API directory discovery
description: Why non-function files under the repository-root api directory can break Vercel builds.
---

Keep tests and other non-function modules out of the repository-root `api/` directory. Vercel discovers files there as serverless functions before the configured build command runs.

**Why:** If the build later recreates or deletes `api/`, Vercel can still expect a pre-discovered test file and fail after a successful bundle with `ENOENT`.

**How to apply:** Put API tests under the server artifact's test or scripts directory. Reserve root `api/` for deployable function entrypoints and runtime files that survive the build.