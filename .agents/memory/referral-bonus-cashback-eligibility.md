---
name: Referral bonus cashback eligibility
description: Business rule for which referral bonus rows contribute to the spendable cashback wallet.
---

Already released/paid referral bonuses are immediately eligible for cashback use. Unpaid bonuses become eligible only after the configured grace period. Expired and reversed bonuses are excluded, and each row contributes only its remaining amount after prior cashback consumption.

**Why:** Customers see a released referral bonus as received money; excluding paid rows from the wallet makes the profile show earnings while checkout incorrectly reports no balance.

**How to apply:** Keep the profile wallet calculation and every checkout balance/reservation query aligned with this rule. Preserve row locking and the existing release/restore flow for concurrent orders, cancellation, refunds, and payment confirmation.