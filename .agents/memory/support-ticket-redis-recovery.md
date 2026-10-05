---
name: Redis pub/sub recovery for ticket SSE
description: How open ticket inboxes recover after a Redis subscriber misses pub/sub messages.
---

When the shared Redis subscriber reconnects, browser SSE connections may still be open and Redis Pub/Sub does not replay missed messages. Wait for the channel subscriptions to be acknowledged, then send a tenant-scoped refresh hint to local ticket streams. The hint contains no ticket data; each tenant's client refetches only its own list, selected messages/events, and queues.

Track a recovery generation for each reconnect. An acknowledgement from an older generation must not refresh clients; if Redis is already ready again, issue a subscription for the latest generation, otherwise wait for the next `ready` event. If the current resubscription rejects while Redis remains ready, keep recovery pending and retry with bounded exponential backoff.

**Why:** ioredis emits `ready` before its automatic resubscription is acknowledged, so `ready` alone is too early to tell connected clients to rehydrate. A second outage can also make an in-flight acknowledgement stale, while a rejected acknowledgement can otherwise leave recovery pending forever.

**How to apply:** For similar SSE consumers, detect each subscriber reconnect, await an acknowledgement for the latest recovery generation, retry failed acknowledgements while the subscriber is ready, and emit a safe refresh/reconciliation signal instead of trying to replay ephemeral events.
