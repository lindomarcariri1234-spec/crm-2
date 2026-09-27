---
name: Expo build port isolation
description: Avoid Metro port collisions when building the mobile artifact alongside the component preview server.
---

Use a configurable Metro port for every Expo static build when another artifact is running on the default Expo port; both cliente-app and guide-app must use it consistently.

**Why:** The component preview server can occupy port 8081. A non-interactive Expo export then aborts instead of selecting another port, which makes an otherwise healthy mobile build fail.

**How to apply:** Keep 8081 as the default for normal builds. When the component sandbox or another Expo build is active, set `EXPO_METRO_PORT` to an unused local port so Metro startup, health checks, bundle downloads, manifests, and asset rewrites all target the same process.

An isolated port does not solve Metro's separate `ENOSPC` file-watcher limit. When several Expo/component Metro servers are active, inspect watcher pressure and run only one static build at a time; do not treat this as an application bundling defect.

**Why:** A build on an unused port started successfully but failed while Metro's fallback watcher opened files under workspace `node_modules`.

**How to apply:** If Metro reports `System limit for number of file watchers reached`, stop or wait for other Metro workflows before retrying, then restart the previews afterward. Avoid changing app code or raising system limits just to mask a transient workspace limit.