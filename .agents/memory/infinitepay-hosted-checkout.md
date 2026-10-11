---
name: InfinitePay hosted checkout
description: Documented trust and lifecycle boundaries of InfinitePay's hosted checkout API.
---

Treat redirect parameters and webhook payloads as untrusted. The documented server-side `payment_check` request binds confirmation to the merchant handle, `order_nsu`, `transaction_nsu`, and invoice slug.

Official documentation reviewed for this integration does not document webhook signatures, decline/cancel/refund events, fee or settlement details, or a checkout API parameter that caps installments at six. Do not claim those capabilities or commercial terms are verified; do not trust a callback-provided receipt URL without an independent binding.

**Why:** the available official API docs describe hosted link creation, paid-payment notification, and status verification, but leave these other provider capabilities unspecified.

**How to apply:** verify every customer return and payment webhook server-side. Keep account eligibility, handle configuration, installment limits, fees, settlement, and refund procedures subject to confirmation with the merchant's InfinitePay account.

Link creation also requires **Checkout Integrado** to be enabled in the merchant's InfinitePay app/web settings, and the handle must be sent without the leading `$`. The official [checkout docs](https://www.infinitepay.io/checkout-documentacao) and [help article](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay) show successful `/links` responses but do not publish an error-body schema. A 422 alone cannot identify which account or payload field was rejected; do not infer codes or paths from arbitrary response strings, and never log the raw body.

**Why:** the official InfinitePay setup guide lists activation as a prerequisite, while checkout validation responses may not expose a safe error code.

**How to apply:** when `/links` returns 422, classify only the HTTP status, verify merchant-side activation and the exact handle before changing the request contract, and add response-derived diagnostics only after InfinitePay documents a safe code or field-path format.

The storefront accepts Brazilian phone numbers in national formatting, while InfinitePay's documented `customer.phone_number` example uses `+55` international format. Normalize Brazilian local numbers to `+55` before sending; omit the optional phone field if it cannot be safely normalized.

**Why:** passing a display-formatted local phone directly can violate provider validation even when the checkout form accepts it.

**How to apply:** normalize only the InfinitePay request payload; preserve the customer's original phone in the order record.
