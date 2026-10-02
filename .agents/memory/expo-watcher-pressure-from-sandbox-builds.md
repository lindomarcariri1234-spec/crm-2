---
name: Expo watcher pressure from sandbox builds
description: How sandbox output and PNPM dependency links affect Metro file watching and bundling.
---

A mockup-sandbox Vite build creates many files under its ignored `dist` directory. Expo Metro may attempt to watch that output and fail with `ENOSPC`; cleaning the generated directory can help. If the error then moves to React Native's native source tree, broader workspace watcher pressure remains.

With PNPM, watching only real package roots can hide dependency links stored beside a package in its `.pnpm/.../node_modules` directory. Add only the specific sibling link roots needed by Metro; crawling those directories recursively across the entire dependency graph can create a large watch set and stall bundling. A Metro-ready message or HTML response is not proof that the JavaScript bundle resolves.

**Why:** Cleaning sandbox output did not always clear `ENOSPC`, while broad PNPM link-folder traversal caused bundle requests to hang and narrowly scoped watching exposed missing peer dependencies.

**How to apply:** Before restarting Expo after a sandbox build, remove only the generated ignored `dist` output. If `ENOSPC` persists, inspect Metro's watch graph and exclusions. For resolution errors, inspect the importing package's declared peers and adjacent PNPM links, then verify an actual bundle request rather than only workflow startup.