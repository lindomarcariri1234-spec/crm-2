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

For ticket SSE delivery, keep runtime validation/projection aligned across Redis publishing, Redis subscription, and direct SSE delivery. Reject event IDs containing control, line-separator, or paragraph-separator characters before any `id:` line write or subscriber fan-out, while preserving all other valid ID bytes. Project onto the explicit public contract fields (`eventId`, `type`, `ticketId`) and strip unknown fields rather than rejecting otherwise valid ticket or queue events.

**Why:** Carriage returns, line feeds, and other control characters can alter SSE framing when interpolated into the `id:` line. Broker payloads and runtime caller objects may also contain private or internal data beyond the public event contract.

**How to apply:** When adding a ticket SSE variant or field, update the public type and shared runtime validators together and use them at every delivery boundary. Never forward parsed Redis payloads or caller-supplied update objects verbatim; test valid frame bytes plus malformed inputs at both Redis and direct-emitter boundaries, and never log raw event IDs.

Keep `SupportTicketUpdatePayload` as a discriminated union: ticket events require a nonblank ticket ID, while queue and recovery-refresh events require `ticketId: null`. The SSE emitter validates this shape at runtime too. Keep recovery `refresh` hints separate from broadcastable ticket and queue updates; recovery refreshes use their explicit local rehydration path after subscription acknowledgement.

**Why:** Redis subscribers ignore `refresh` messages from the update channel, so allowing the broadcaster to publish them can make a successful publish appear valid while every subscriber drops the hint. A broad type can also represent impossible type/ID pairs, and direct emitter callers need runtime protection.

**How to apply:** Preserve these distinctions when extending support-ticket event types; update both the discriminated union and runtime validator, and keep compile-time/runtime tests for valid shapes and recovery-only routing.

Long-lived support-ticket SSE streams must recheck the persisted user's active state, identity, tenant, and staff role on the heartbeat. Close and unregister a stream if the user is missing, disabled, moved to another tenant, no longer staff, or the check fails.

**Why:** HTTP authorization runs only when an SSE request opens; the connection can outlive later account and role changes while still receiving tenant broadcasts.

**How to apply:** Revalidate against current database fields rather than the connection's initial user snapshot, fail closed when current access cannot be confirmed, and test revocation plus ordinary disconnect cleanup.

For rejected support-ticket Redis messages, aggregate counts under a fixed set of reason codes and report only the reason and count at most once per minute. Flush pending counts when the subscriber closes; never log parse errors or envelope/payload fields.

**Why:** Invalid JSON and broker messages can contain customer or cross-tenant identifiers; per-message error logs could expose those values and flood logs during a bad producer rollout.

**How to apply:** Keep reason keys bounded, use only fixed reason codes plus aggregate counts in reports, clear the reporting timer during flush/shutdown, and test that counts aggregate without sensitive values.
