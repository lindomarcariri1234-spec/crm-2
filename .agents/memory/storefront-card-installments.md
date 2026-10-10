---
name: Storefront card installments
description: Policy for offering credit-card installment plans in the public reservation wizard.
---

Do not advertise or enable Brazilian card installments unless Stripe's published support and the configured account both confirm eligibility. Stripe's published installment products currently cover Mexico, Japan, and selected Mastercard Installments markets, not Brazilian-issued cards; fail closed for BRL storefront card payments.

**Why:** Stripe's official installments documentation does not list Brazil, and its Brazil payment-method support page does not establish Brazilian installment eligibility. The old 1x/2x controls also changed only local UI state and were never sent to the payment API.

**How to apply:** Recheck Stripe's official country/product support and the actual account's eligible plans before adding installment UI. Until both confirm support, do not set `payment_method_options.card.installments.enabled`, and reject requests for more than one installment rather than silently charging once.
