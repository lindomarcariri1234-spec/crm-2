---
name: Audit failure log hygiene
description: Safe operational logging rules for failures while writing audit records
---

Audit-write failure logs must use an allowlist of operational metadata: operation, tenant, entity type/id, request id, and a non-sensitive error type. Never serialize the audit snapshots or the raw exception message/object.

**Why:** Audit snapshots can contain user-entered operational data, while database exceptions can expose SQL or infrastructure details. The browser already receives a generic failure response, so internal diagnostics need correlation without copying those payloads into a second log.

**How to apply:** Route-level audit helpers should call the shared safe logger and rethrow the original exception so the enclosing transaction still rolls back. Add a test that asserts the metadata excludes `before`/`after` and exception details.