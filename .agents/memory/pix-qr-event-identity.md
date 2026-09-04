---
name: PIX QR event identity
description: Idempotency and channel-selection rule for customer-facing order QR delivery.
---

The customer-facing PIX QR is one logical event per order. Its idempotency identity must be scoped to the tenant and order, never to the mutable delivery-mode setting. The mode controls the payload channels on the first durable event; a replay must not create a second message merely because the agency setting changed. A replay may reopen only failed/provider-unavailable deliveries from that original persisted mode.

**Why:** A checkout replay can observe a different agency setting from the original checkout. Including `email`, `whatsapp`, or `all` in the event key turns that configuration change into a duplicate external delivery.

**How to apply:** Keep the stable order-scoped key when enqueueing the QR, and rely on the outbound message's unique tenant/key constraint plus its one-delivery-per-channel constraint. On replay, call the existing delivery retry operation only for failed or provider-unavailable selected channels; never retry accepted or permanent-skip deliveries. Treat later mode changes as a new explicit resend requirement, not as an implicit replay.