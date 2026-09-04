---
name: Capacity integrity check
description: Read-only reconciliation of trip, inventory, and dated partner capacity before repair jobs.
---

The capacity integrity check must remain diagnostic: compare persisted claims and counters, log each divergence with tenant, resource, metric, and difference, and never repair data or create new claims.

**Why:** Capacity mismatches can affect new sales, but automatically guessing a correction risks changing financial or operational history.

**How to apply:** Schedule the diagnostic before any legacy counter-repair job so the original drift is observable; use persisted reservation capacityUnits for trips without numbered seats, and treat released inventory claims as historical ownership rather than active claims.