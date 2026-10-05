---
name: Seat update payload bounds
description: Seat SSE and Redis validation limits and compatibility rationale.
---

Seat updates are validated and projected at the database publisher, Redis subscriber, and SSE emitter. Keep the current ceilings aligned across those boundaries: 128 characters for trip IDs, 128 seats per update, 80 characters for a seat number, 32 characters for a status, and 128 KiB for a raw Redis message. Preserve arbitrary non-empty status strings within the limit rather than introducing a whitelist.

**Why:** Generated trip IDs are 16 characters and seat imports already allow 80-character labels, but the schema has no maximum trip capacity. A 128-seat ceiling provides headroom without allowing unbounded frames. Consumers accept statuses beyond the current producer values, so a whitelist could silently break valid frames. Redis input must be size-checked before parsing, and rejection logs must never include message contents.

**How to apply:** If changing any bound, update shared validation and its boundary tests together. Confirm the supported trip-layout maximum before raising the seat count, and keep the emitted SSE shape limited to `tripId`, `number`, and `status`.
