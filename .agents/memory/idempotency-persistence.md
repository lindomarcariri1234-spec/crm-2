---
name: Idempotency keys must reach persistence
description: Client-generated idempotency keys can be silently dropped between a route DTO and the database insert.
---

A checkout idempotency guarantee is incomplete until the key is verified in the actual database insert, not only in route validation and preflight lookup.

**Why:** TypeScript structural typing can accept a request object with extra fields while an intermediate service type omits them, causing retries to create duplicate orders without any type or build error.

**How to apply:** When adding idempotency to a route, trace the field from request schema through every service argument to the persistence values object, and test the persisted payload or a real duplicate request.

For multi-stage checkout, keep the same key alive until every stage that depends on the created order has succeeded. A payment-setup failure after order persistence must retry with the original key; clearing it immediately after `createOrder` makes the next attempt create a second order even when the server can safely replay the first one.

**Why:** Order creation reserves inventory and referral credit before card setup completes, so a later payment error is not a signal that the order creation should be repeated with fresh state.

**How to apply:** Clear the checkout key only after payment setup succeeds (or after a non-card order is fully submitted); keep the already-created cart state available so the customer can retry the payment step.

For trip WhatsApp broadcasts, deduplicate by a stable logical campaign identity (trip, filter, normalized message, and sorted recipient set), plus each normalized recipient phone. Different staff request IDs must not split one campaign; a deliberate identical resend gets an explicit fresh campaign UUID.

**Why:** Request IDs are generated independently by each staff member, so request-level keys cannot prevent overlapping campaigns. The outbound-message unique index makes a stable per-recipient campaign key atomic, while an explicit campaign UUID preserves intentional repeat sends.

**How to apply:** Compute the default campaign identity server-side from the selected audience and payload; preserve the explicit campaign UUID on retries and expose a clear user action for intentional identical sends. Report only WhatsApp delivery: pending is queued, accepted means the provider accepted it (not delivered), and processing or an ambiguous exception is unknown.

When a broadcast reuses an existing outbox row, expose that outcome separately from accepted/queued counts so staff are not told that a new send just occurred.

**Why:** Idempotent replays return the previous delivery state; without a distinct marker, a reused accepted row looks like a freshly sent message.

**How to apply:** Propagate the outbox `created` result through the WhatsApp helper and aggregate a recipient count in the route response. Keep the UI message aggregate-only and offer the explicit new-campaign path.