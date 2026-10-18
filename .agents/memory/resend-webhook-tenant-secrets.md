---
name: Resend webhook tenant secrets
description: Keep Resend callback signature verification isolated by tenant.
---

Resend creates a signing secret unique to each webhook endpoint, while the app routes callbacks by tenant ID. Resolve verification against that tenant's secret; never use another tenant's secret as a fallback when a tenant map is configured. Keep secrets in Replit Secrets and out of logs.

**Why:** A shared secret can authenticate a forged callback for another tenant, and a single global value cannot verify independently generated webhook secrets.

**How to apply:** Maintain tenant-scoped configuration in `RESEND_WEBHOOK_SECRETS_JSON`, retain the global `RESEND_WEBHOOK_SECRET` only for a single-tenant compatibility path, and test valid, cross-tenant, and missing-map cases.
