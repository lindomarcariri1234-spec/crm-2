---
name: Vitest real-database test isolation
description: Prevent ordinary API test runs from writing fixtures to the configured database.
---

Real-database API tests must be excluded from the default Vitest configuration, listed in the dedicated integration configuration, and run by CI only after its isolated database is migrated. Keep both lists synchronized.

**Why:** A manually assembled file batch can include DB-backed suites that the default configuration does not exclude. Their setup and cleanup hooks write to the configured database, and cleanup cannot be assumed to have completed successfully.

**How to apply:** Before running explicit Vitest file lists, independently filter out every real-DB suite; prefer the normal unit command for local checks. Run integration tests only against a dedicated test database, never a developer or production database. For an explicit file target, invoke Vitest directly with `pnpm exec vitest run`; appending `-- --file` to the package script may pass the separator through and run the full default suite instead.