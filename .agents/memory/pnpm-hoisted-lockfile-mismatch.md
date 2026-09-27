---
name: PNPM linker and resolver peer resolution
description: Distinguish package-manager linker issues and keep React Hook Form's Zod types aligned
---

**Rule:** If a local frozen install with `node-linker=hoisted` reports a missing snapshot, verify with the deployment's pinned pnpm version before changing unrelated lock entries. In a workspace containing Zod 3 and Zod 4, declare Zod 3 as a peer for `@hookform/resolvers` 3.10 because its package metadata omits that peer even though its adapter types import Zod.

**Why:** Local pnpm 10.26 rejected a Clerk snapshot with the hoisted linker while pnpm 10.28 accepted the frozen install. A clean install also let the resolver's declarations pick up Zod 4 from the virtual store, producing a Zod 3 form-schema mismatch; the explicit peer context links the intended Zod 3.

**How to apply:** Preserve focused lockfile edits and use the deployment-matched pnpm version for frozen-install verification. When diagnosing a Zod resolver mismatch, resolve `zod` from the actual `@hookform/resolvers` package path and fix the peer context rather than changing the form component.