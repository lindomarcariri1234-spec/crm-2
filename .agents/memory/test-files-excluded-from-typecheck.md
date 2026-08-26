---
name: Test files excluded from typecheck
description: The official typecheck workflow can exclude an entire test directory, so a broken test file passes CI silently.
---

- Before trusting a "clean typecheck" result for a change that touches or adds test files, check the relevant `tsconfig*.json` used by the typecheck workflow for an `exclude` entry covering the test directory. If tests are excluded, that run says nothing about test-file correctness.
- **Why:** a project's typecheck workflow may deliberately exclude `src/__tests__` (or similar) from its primary config, e.g. to keep the workflow fast or avoid unrelated pre-existing test-only errors. Running only that config gives false confidence — a genuinely broken new test file compiles fine as far as CI is concerned, and the breakage only surfaces if someone runs a full `tsc` pass without the exclude (e.g. a manual check or a stricter reviewer pass).
- **How to apply:** when adding or editing a `.test.ts`/`.test.tsx` file, do a one-off full-project typecheck that does NOT carry the test exclusion (e.g. a temporary tsconfig extending the real one with `exclude: []`, deleted after use) before considering the change verified. Don't rely solely on the named typecheck workflow/command for test-file correctness if you have any reason to suspect it excludes tests.
