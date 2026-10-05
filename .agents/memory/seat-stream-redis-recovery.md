---
name: Seat stream Redis recovery
description: Rehydrate seat occupancy after Redis subscriber recovery without sharing seat data across tenants or trips.
---

After the shared Redis subscriber confirms its channel resubscriptions, seat streams receive a hint containing only `type: "refresh"` and their own trip ID. Each client fetches the existing seat-map endpoint using the current authenticated session, or the public store slug plus trip ID. Do not put occupancy data in the recovery hint.

**Why:** Redis Pub/Sub does not replay missed updates. A broad seat-data broadcast could cross tenant or trip boundaries; a scoped re-fetch returns current database state under the same authorization checks as the seat-map page.

**How to apply:** For seat-stream recovery, send a per-trip hint and rehydrate through the existing tenant-checked endpoint. Keep browser EventSource connections open and let their current page refresh its own queries.
