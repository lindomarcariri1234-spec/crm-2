---
name: STORE_ORDER_STATUS PROCESSING constant
description: STORE_ORDER_STATUS in permissions includes PROCESSING since pedidos.tsx migration.
---

# STORE_ORDER_STATUS — full set of values

`STORE_ORDER_STATUS` in `lib/permissions/src/index.ts`:
```
PENDING, CONFIRMED, PROCESSING, COMPLETED, CANCELLED
```

`STORE_PAYMENT_STATUS`: `PENDING, PAID, REFUNDED, FAILED`

**Why:** PROCESSING was not in the original constant. Added when `pedidos.tsx` (loja/pedidos.tsx) was migrated from hardcoded `"processing"` strings to typed constants.

**How to apply:** Always use `STORE_ORDER_STATUS.PROCESSING` (not the raw string `"processing"`) in label maps, badge helpers, and DB comparisons for store orders.
