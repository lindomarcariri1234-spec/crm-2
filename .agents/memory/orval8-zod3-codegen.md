---
name: Orval 8 with Zod 3
description: Compatibility requirements when upgrading the API generator while the workspace remains on Zod 3.
---

Keep Orval's Zod output explicitly on version 3 until the workspace intentionally migrates to Zod 4. Format generated files as a separate codegen step, and include DOM iterable types for generated fetch clients that iterate `Headers`.

**Why:** Newer Orval 8 releases can otherwise emit Zod 4-only APIs, skip the previously expected formatting, and generate `Headers.entries()` calls that fail shared-library typechecks.

**How to apply:** On future Orval upgrades, regenerate both API packages, verify deterministic output, build their declarations, and typecheck both the API server and web consumer before accepting the lockfile.