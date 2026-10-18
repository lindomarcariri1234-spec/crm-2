---
name: Storefront child fares
description: Fare rules for children in trip-linked storefront checkout.
---

In storefront bookings, the primary buyer uses the adult fare. A child occupying a seat uses the linked trip's configured child fare; when no child fare is configured, use the adult fare. An under-7 child travelling on a lap is free and consumes no seat.

**Why:** Trip setup already supports a separate child price, and using it avoids charging every seated passenger the adult amount.

**How to apply:** Keep the browser's fare breakdown aligned with the trip's child price, but recalculate and persist the authoritative fare on the server before discounts and payment.
