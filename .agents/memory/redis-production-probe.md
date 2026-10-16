---
name: Production-only Redis probe access
description: Distinguishes private Redis DNS in production from workspace connectivity during queue diagnostics.
---

The BullMQ queue Redis hostname may resolve only inside the production deployment network. A workspace-shell `ENOTFOUND` is not proof that its credentials or service are invalid; use the production worker probe to diagnose the service itself.

**Why:** production logs showed a connected queue Redis while the same configured hostname was not resolvable from the workspace shell.

**How to apply:** do not use a local-shell connection failure as the basis for changing production Redis configuration. Make production probes report a safe error category and command name, then inspect those logs before changing the Redis resource or reactivating workers.
