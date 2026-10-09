---
name: Storefront card installments
description: Policy for offering credit-card installment plans in the public reservation wizard.
---

Do not advertise a fixed Brazilian card-installment plan in the storefront until support for the configured Stripe account is verified. Prefer Stripe-controlled payment UI over a local selector that does not affect the charge.

**Why:** The old 1x/2x controls changed only local UI state and were never sent to the payment API; generic Stripe documentation did not establish installment eligibility for this account.

**How to apply:** Before adding installments, verify account and payment-method support, then carry the selected schedule through both the wizard and the server-created PaymentIntent. Until then, show only Stripe-supported payment options without promising installments.
