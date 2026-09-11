---
name: Stripe 3DS checkout recovery
description: Design rule for recovering redirected storefront card checkouts and their cashback summary
---

After a Stripe 3DS redirect, the storefront must recover the order from the persisted one-shot order lookup token instead of relying on the cart. Persist the requested/applied cashback snapshot with that lookup, because the public order lookup is authoritative for the total but may not expose the pending cashback spend details.

**Why:** Stripe returns to the checkout URL after a full page navigation, so the cart and React state may be gone; recalculating from the refreshed wallet balance can show a different discount than the already-created order.

**How to apply:** Detect the Stripe return query, validate the stored lookup's store slug, fetch the order with its token, use the returned total plus the stored applied-credit snapshot, and remove only Stripe query parameters after recovery.