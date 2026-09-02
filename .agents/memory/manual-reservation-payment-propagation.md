---
name: Manual reservation payment propagation
description: Safe propagation rules from CRM reservation payments to storefront orders, referrals and Pipeline.
---

A manual receivable payment linked to a storefront reservation must first recalculate the reservation. The storefront order may transition to paid only when every tenant-local reservation sharing its order number has zero balance.

The order must be locked before inventory effects, status transition and settlement are applied. The unpaid-to-paid transition is the one-time gate for non-idempotent inventory and general post-payment effects.

Referral conversion recovery remains independently idempotent: after an exact pending-referral-to-reservation link is repaired, a confirmed zero-balance reservation may retry only the referral conversion.

**Why:** A single storefront checkout can create multiple reservations, and replaying manual confirmation can otherwise double inventory, settlements, activities or notifications. Blocking every replay would also strand referral conversions after a post-commit failure.

**How to apply:** Use the shared reservation-order payment synchronizer from payment writes and linked-data reconciliation. Never infer a referral from code alone when multiple pending rows exist; use the referral ID persisted in the order.