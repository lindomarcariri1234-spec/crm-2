---
name: Expo watcher pressure from sandbox builds
description: How generated mockup build output can contribute to Metro file-watcher exhaustion.
---

A mockup-sandbox Vite build creates many files under its ignored `dist` directory. Expo Metro may attempt to watch that output and fail with `ENOSPC`; cleaning the generated directory can help. If the error then moves to React Native's native source tree, broader workspace watcher pressure remains.

**Why:** A Metro failure first pointed at the newly generated sandbox `dist`; after cleanup and restart, another failure pointed into `ReactAndroid`, showing cleanup is useful but not always sufficient.

**How to apply:** Before restarting Expo after a sandbox build, remove only the generated ignored `dist` output. If `ENOSPC` persists, inspect Metro's watch graph and exclusions instead of repeatedly restarting.