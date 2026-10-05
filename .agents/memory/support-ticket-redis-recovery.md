---
name: Redis pub/sub recovery for ticket SSE
description: Recovery and safe ticket payload projection for Redis and local SSE delivery.
---

When the shared Redis subscriber reconnects, browser SSE connections may still be open and Redis Pub/Sub does not replay missed messages. Wait for the channel subscriptions to be acknowledged, then send a tenant-scoped refresh hint to local ticket streams. The hint contains no ticket data; each tenant's client refetches only its own list, selected messages/events, and queues.

Track a recovery generation for each reconnect. An acknowledgement from an older generation must not refresh clients; if Redis is already ready again, issue a subscription for the latest generation, otherwise wait for the next `ready` event. If the current resubscription rejects while Redis remains ready, keep recovery pending and retry with bounded exponential backoff.

Keep initial channel fan-out inactive until the first explicit subscription acknowledgement. If that acknowledgement fails, treat startup as recovery-pending; retry after `ready` or with backoff while ready, then send one safe refresh after the successful acknowledgement.

**Why:** ioredis emits `ready` before its automatic resubscription is acknowledged, so `ready` alone is too early to tell connected clients to rehydrate. A second outage can make an in-flight acknowledgement stale, and either an initial or later rejected acknowledgement can otherwise leave recovery pending forever.

**How to apply:** For similar SSE consumers, keep fan-out disabled until acknowledged, detect each subscriber reconnect, await an acknowledgement for the latest recovery generation, retry failed acknowledgements while ready, and emit a safe refresh/reconciliation signal instead of trying to replay ephemeral events.

With real ioredis, rapid stop/restart cycles can leave multiple explicit subscribe acknowledgements in flight within the same recovery generation. Accept multiple attempts, but allow only the current generation to trigger one refresh.

**Why:** A real-Redis test observed overlapping acknowledgements while reconnects were progressing; assuming one subscribe attempt made the race test miss a valid interleaving.

**How to apply:** In recovery tests, track and gate acknowledgements by generation, then assert that stale acknowledgements emit nothing and all current-generation completions produce only one refresh.

For ticket SSE delivery, project payloads onto the explicit public contract fields (`eventId`, `type`, `ticketId`) on both Redis-subscriber and local-fallback paths. Strip unknown fields rather than rejecting otherwise valid ticket or queue events.

**Why:** Broker payloads and runtime caller objects may contain private or internal data beyond the public event contract; projecting known fields prevents accidental exposure without blocking valid updates.

**How to apply:** When adding a ticket SSE field, update the public type and shared projection together. Never forward parsed Redis payloads or caller-supplied update objects verbatim; test both Redis fan-out and fallback paths.

Keep `SupportTicketUpdatePayload` as a discriminated union: ticket events require a nonblank ticket ID, while queue and recovery-refresh events require `ticketId: null`. The SSE emitter validates this shape at runtime too. Keep recovery `refresh` hints separate from broadcastable ticket and queue updates; recovery refreshes use their explicit local rehydration path after subscription acknowledgement.

**Why:** Redis subscribers ignore `refresh` messages from the update channel, so allowing the broadcaster to publish them can make a successful publish appear valid while every subscriber drops the hint. A broad type can also represent impossible type/ID pairs, and direct emitter callers need runtime protection.

**How to apply:** Preserve these distinctions when extending support-ticket event types; update both the discriminated union and runtime validator, and keep compile-time/runtime tests for valid shapes and recovery-only routing.
