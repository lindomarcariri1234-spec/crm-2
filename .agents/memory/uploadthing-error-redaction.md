---
name: UploadThing error redaction
description: Avoid exposing UploadThing credentials when structured logs serialize SDK request errors
---

Never pass raw UploadThing SDK errors to structured logging. SDK request errors can contain the outgoing request headers, including the API key. For UploadThing list/delete failures, log only fixed operation context and non-sensitive counters.

**Why:** A failed provider call can serialize the credential into application logs even when the exception message itself appears harmless.

**How to apply:** Apply this rule to every UploadThing SDK call; if a credential has already been logged, revoke it with the provider and replace the workspace secret through the secure Secrets flow.