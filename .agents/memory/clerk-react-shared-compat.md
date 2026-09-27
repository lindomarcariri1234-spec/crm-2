---
name: Clerk React and shared compatibility
description: Why the web Clerk React package is pinned against the workspace's shared override.
---

Keep the web Clerk React dependency compatible with the workspace-wide Clerk shared override; do not let a range silently resolve to a newer incompatible minor release.

**Why:** A clean lockfile resolution selected a newer React package that imported a hook absent from the overridden shared package. Typechecking passed, but the production Vite build failed at module linking. The previously published exact React version builds with the override.

**How to apply:** When upgrading Clerk, test the React package and the shared override as a pair with a fresh lockfile installation and production build before relaxing the version pin.