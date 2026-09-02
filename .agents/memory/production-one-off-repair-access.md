---
name: Production one-off repair access
description: Constraint discovered when an operational repair exists locally but production data is only reachable through a read-only replica
---

Production inspection and production mutation may be exposed through different channels. A read-only production SQL replica can confirm the target row but cannot execute a repair, while the workspace shell may point at development data and an installed provider integration may point at a different database. Do not treat a dry-run that finds no row in either alternate source as evidence that the production row is gone.

**Why:** A one-off reservation repair required a row-level transaction against the live database, but the available production query surface explicitly rejected writes and the local/deployed connection paths did not expose the same dataset.

**How to apply:** Before attempting a destructive or corrective one-off operation, identify a supported write-capable operational execution path and run the exact idempotent routine there; otherwise report the target's verified read-only state and leave the data unchanged.