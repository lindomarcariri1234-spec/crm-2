---
name: API Vitest integration selection
description: How the API server separates and targets integration tests.
---

The API server's default Vitest config excludes database integration tests, and `vitest.integration.config.ts` has an explicit include list. Add each new integration test file to that list or Vitest will report no matching tests even when given its path.

Avoid `pnpm run test:integration -- <path>` for targeting one file: the script's shell prefix caused Vitest to run the full integration suite in this environment. Use `pnpm --filter @workspace/api-server exec vitest run --config vitest.integration.config.ts <path>` after registering the file.

**Why:** A misrouted command launched unrelated integration tests against the shared development database, while a direct filtered invocation initially ran zero files because the new test was not registered.

**How to apply:** When adding or running an API database integration test, update the explicit include list and use the direct Vitest command with the integration config for a targeted check.
