---
name: Published Stripe test mode warning
description: Product decision for test credentials in published agency settings and storefront checkout.
---

Production builds show a warning when a store has a Stripe test publishable key. The settings warning makes clear that enabling Stripe remains allowed, while the public checkout tells customers the transaction will not create a real charge. Development builds continue using test credentials without this production warning; do not block activation based only on key mode.

**Why:** Agencies may intentionally test a published storefront, but administrators and customers should not mistake test-mode payments for real charges. Blocking activation would interfere with hosted end-to-end testing and local development.

**How to apply:** Base the warning on the production build flag and the public-key mode. Keep the credential validator and checkout behavior environment-neutral; cover the published warning, the no-block policy, and development use of test credentials in tests.
