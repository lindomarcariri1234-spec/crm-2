---
name: Instagram Direct scope
description: Product and Meta policy constraints for agency Instagram DM messaging.
---

- Agencies connect their own Instagram Business or Creator account through Meta Business Login; do not use a shared agency account or a Replit integration.
- Treat this as a customer-support inbox: reply only to customer-initiated DMs and only within Instagram's standard 24-hour window. Do not add cold outreach without an explicit scope and policy review.
- Current supported messaging is text. Inbound attachments are represented by a placeholder; do not imply media download or outbound media support.
- Store Meta app credentials and the webhook verification token in workspace Secrets; never put their values in source, chat, or logs.
- Meta data-deletion requests remove Instagram credentials, conversations, and messages while preserving shared client records and other-channel history.

**Why:** The feature is for agency replies to customer-initiated conversations, not an outbound marketing channel, and Meta applies messaging-window and app-access requirements. The user also selected a deletion boundary that preserves shared CRM records and other-channel history.

**How to apply:** Preserve the inbound-first, text-only scope when extending the Instagram inbox. On Meta deletion requests, delete only the Instagram connection and Instagram-channel records. Validate against a configured Meta app before claiming live OAuth, webhook, or DM delivery works.
