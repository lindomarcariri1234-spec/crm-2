---
name: Vite build vs. serve environment
description: Keep runtime-only environment validation from preventing Vite static artifact builds.
---

Require `PORT` and `BASE_PATH` when starting the preview server, but allow `vite build` to run without them; use a harmless build fallback and still reject invalid supplied port values.

**Why:** The workspace's recursive production build invokes Vite without workflow runtime variables, while the preview workflow must retain strict port/path configuration.

**How to apply:** Branch on Vite's `command` in the config factory, then verify both `vite build` with no runtime variables and the configured preview workflow.
