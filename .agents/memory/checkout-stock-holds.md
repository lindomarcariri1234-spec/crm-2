---
name: Checkout stock hold semantics
description: Preserve the current storefront stock lifecycle when explanatory comments disagree with runtime behavior.
---

For VisiteCRM store checkout, retain the current behavior: tracked, non-backorder product stock is claimed when the order is created; payment transitions the claim to sold and applies sales/coupon/store metrics; releasing an unpaid hold restores the claimed stock. If comments describe stock decrement as payment-time but runtime code reserves it at checkout, treat those comments as stale and do not change the behavior.

**Why:** The user explicitly directed that the code's behavior is more reliable than the conflicting comments and that the existing behavior must remain.

**How to apply:** When editing the storefront checkout inventory lifecycle, preserve the transactional checkout claim and release semantics unless the user explicitly requests a behavior change.
