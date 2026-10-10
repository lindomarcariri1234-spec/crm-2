---
name: InfinitePay hosted checkout
description: Documented trust and lifecycle boundaries of InfinitePay's hosted checkout API.
---

Treat redirect parameters and webhook payloads as untrusted. The documented server-side `payment_check` request binds confirmation to the merchant handle, `order_nsu`, `transaction_nsu`, and invoice slug.

Official documentation reviewed for this integration does not document webhook signatures, decline/cancel/refund events, fee or settlement details, or a checkout API parameter that caps installments at six. Do not claim those capabilities or commercial terms are verified; do not trust a callback-provided receipt URL without an independent binding.

**Why:** the available official API docs describe hosted link creation, paid-payment notification, and status verification, but leave these other provider capabilities unspecified.

**How to apply:** verify every customer return and payment webhook server-side. Keep account eligibility, handle configuration, installment limits, fees, settlement, and refund procedures subject to confirmation with the merchant's InfinitePay account.
