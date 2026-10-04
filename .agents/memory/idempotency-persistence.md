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

For repeatable broadcasts, keep one request ID stable across retries and include it with the trip and normalized recipient phone in the persisted delivery idempotency key. After a successful response, issue a new request ID for the next intentional send. Report only the WhatsApp delivery: pending is queued, accepted means the provider accepted it (not delivered), and processing or an ambiguous exception is unknown.

**Why:** A permanent trip-and-phone key suppresses later legitimate reminders, while a transient provider result must not be reported as success or retried as a definite failure.

**How to apply:** Keep the ID when retrying an uncertain request and direct staff to check the delivery history before sending again; reset it after confirmed request success.