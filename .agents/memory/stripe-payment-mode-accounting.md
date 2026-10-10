---
name: Stripe payment mode accounting
description: Rules for classifying Stripe payments and treating unverifiable historical transactions in financial reports.
---

Use Stripe's transaction `livemode` as the authoritative source for test versus live mode. Never infer a payment's mode from the account's current credentials.

**Why:** The user chose to leave historical Stripe payments with no verifiable mode unclassified and exclude them from real-revenue reports, rather than risk treating a test payment as real income.

**How to apply:** Persist unknown Stripe mode as null, exclude test and unknown Stripe payments from real-cash totals, and expose the unknown state in order views and exports. Backfill only when historical Stripe/order data verifies the mode.
