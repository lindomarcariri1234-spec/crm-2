---
name: Completed-trip storefront availability
description: Completed trip products should be hidden and stale storefront carts should not be finalized.
---

Completed trips are unavailable for new storefront purchases even if a customer still has the product in an already-open cart. Keep the product and historical order records intact; do not implement this by deleting or deactivating the product.

**Why:** the user confirmed that checkout must be blocked after the linked trip is marked completed.

**How to apply:** filter completed linked trips from public catalog/detail and related storefront queries, reject them during checkout preparation, and recheck under the trip row lock before creating reservations to close the in-flight checkout race.
