---
name: Instagram Direct scope
description: Product and Meta policy constraints for agency Instagram DM messaging.
---

- Agencies connect their own Instagram Business or Creator account through Meta Business Login; do not use a shared agency account or a Replit integration.
- Treat this as a customer-support inbox: reply only to customer-initiated DMs and only within Instagram's standard 24-hour window. Do not add cold outreach without an explicit scope and policy review.
- Zernio-imported inbound media may be displayed from the first validated provider URL; do not imply app-hosted storage or outbound media support. Keep other Instagram providers text-only unless explicitly scoped.
- Store Meta app credentials and the webhook verification token in workspace Secrets; never put their values in source, chat, or logs.
- Meta data-deletion requests remove Instagram credentials, conversations, and messages while preserving shared client records and other-channel history.

**Why:** The feature is for agency replies to customer-initiated conversations, not an outbound marketing channel, and Meta applies messaging-window and app-access requirements. The user explicitly scoped read-only display for imported Zernio attachments, not general media hosting or sending.

**How to apply:** Preserve the inbound-first scope when extending the Instagram inbox. Render only safe HTTP(S) provider URLs for imported Zernio attachments. On Meta deletion requests, delete only the Instagram connection and Instagram-channel records. Validate against a configured Meta app before claiming live OAuth, webhook, or DM delivery works.
