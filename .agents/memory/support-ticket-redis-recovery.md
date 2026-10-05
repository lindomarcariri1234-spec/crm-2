---
name: Redis pub/sub recovery for ticket SSE
description: How open ticket inboxes recover after a Redis subscriber misses pub/sub messages.
---

When the shared Redis subscriber reconnects, browser SSE connections may still be open and Redis Pub/Sub does not replay missed messages. Wait for the channel subscriptions to be acknowledged, then send a tenant-scoped refresh hint to local ticket streams. The hint contains no ticket data; each tenant's client refetches only its own list, selected messages/events, and queues.

**Why:** ioredis emits `ready` before its automatic resubscription is acknowledged, so `ready` alone is too early to tell connected clients to rehydrate.

**How to apply:** For similar SSE consumers, detect a real subscriber reconnect, await a successful subscribe acknowledgement, and emit a safe refresh/reconciliation signal instead of trying to replay ephemeral events.
