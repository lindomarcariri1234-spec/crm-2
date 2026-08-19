---
name: Referral reservationId invariant
description: Documents which referral insert paths must set reservationId and which may leave it null, and why.
---

# Referral reservationId invariant

## The rule

There are three paths that call `.insert(referralsTable)`:

1. **CRM path** (`artifacts/api-server/src/routes/reservations.ts`) — inserts a `status='completed'` referral when an admin creates a CRM reservation with a referral code applied. `reservationId` is ALWAYS required here; it is the ID of the reservation just created in the same transaction. A runtime assertion (`if (!id) throw ...`) guards this. The `reservationId` is what allows `reverseReferral()` to find and undo this record when the reservation is cancelled.

2. **Store checkout path** (`artifacts/api-server/src/services/checkout/referral-conversion.ts` called from `persist-order.ts`) — inserts a `status='completed'` referral when an online store order converts a referral code. `reservationId` is set to `firstReservationId` from the same transaction. It is **null** when the order contains only non-trip products (no reservation was created). This is architecturally valid and intentional.

3. **Admin manual POST** (`artifacts/api-server/src/routes/referrals.ts`, `POST /api/referrals`) — creates a referral invite with `status='pending'` (schema default). `reservationId` is absent and intentional; it would only be set if/when the referral later converts (via paths 1 or 2).

## Why

`reservationId` is used by `reverseReferral()` to locate and undo a specific completed referral when a reservation is cancelled. Without it on the CRM path, cancellations silently skip the reversal — the historical data quality bug this task was written to prevent from recurring.

For store orders without trips, there is no reservation to cancel, so null is correct.

## How to apply

- Never add a global NOT NULL constraint on `referrals.reservation_id` — it would break pending invites and product-only store orders.
- If adding a new completed-referral creation path, pass `reservationId` when a reservation exists; document explicitly when and why it may be null.
- Any future `status='completed'` insert on the CRM path must include a non-null `reservationId`.
