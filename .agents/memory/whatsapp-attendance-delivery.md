---
name: WhatsApp attendance delivery
description: Reliability and consent rules for AI and staff WhatsApp conversation replies.
---

Outbound replies in attendance conversations are persisted before a provider call, claimed conditionally, and retried by a bounded background sweep. A conversation marked as opted out must cancel pending sends and reject both AI and staff replies.

**Why:** a successful webhook acknowledgment or queued job is not proof that an external WhatsApp provider delivered a message. A process interruption or provider failure must not lose the reply or resume contact after consent was withdrawn.

**How to apply:** any new attendance reply path must create a tenant-scoped, idempotent outbound record first; use its status transition as the delivery source of truth and let the recovery worker own retries. Never send based only on caller-supplied phone or bypass the conversation opt-out status.