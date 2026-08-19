---
name: Checkout creates reservation/client synchronously, must not fake success
description: Store checkout creates the CRM client/reservation/deal/portal-account at checkout time now (not deferred to payment); the route must never return 200 if that sync step fails
---

## Rule
The store-public checkout route creates the CRM client, reservation, pipeline deal, and portal account synchronously during checkout (not deferred until payment confirmation) so agencies and customers see them immediately for slow payment methods (PIX/boleto).

**Why:** Waiting for payment confirmation left agencies blind to pending bookings for minutes/days, and customers couldn't access the client portal until payment cleared. But this makes the checkout response's success/failure meaning stricter: a 200 must mean the reservation genuinely exists, or downstream consumers (portal login, agency dashboards) will be told something happened that didn't.

**How to apply:**
- Any code path that creates the reservation/client at checkout time must be treated as request-critical, not best-effort: if it throws, the route must return an error (not swallow-and-log-and-200), even though the order row itself may already be persisted.
- The reservation-creation service function is idempotent by orderId, so returning an error and letting the client retry (or letting the later payment-confirmation call pick it up) is safe — it will not create duplicates.
- When adding a new payment-confirmation gate (e.g. "did payment status actually flip to paid in this request"), gate on the *actual state transition*, not on the requested/payload value — a resent or duplicate "paid" webhook/admin action must not re-trigger payment-recording logic whose own dedup key doesn't recognize the other gateway's prior payment.
