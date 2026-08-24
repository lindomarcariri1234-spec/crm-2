---
name: Expo build port isolation
description: Avoid Metro port collisions when building the mobile artifact alongside the component preview server.
---

Use a configurable Metro port for the cliente-app static build when another artifact is running on the default Expo port.

**Why:** The component preview server can occupy port 8081. A non-interactive Expo export then aborts instead of selecting another port, which makes an otherwise healthy mobile build fail.

**How to apply:** Keep 8081 as the default for normal builds. When the component sandbox is active, set `EXPO_METRO_PORT` to an unused local port for the mobile build so health checks, bundle downloads, manifests, and asset rewrites target the same Metro process.