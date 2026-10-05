---
name: WhatsApp support ticketing scope
description: Product boundaries for VisiteCRM's human-support tickets.
---

Create tickets only through the existing human-handoff paths. Each new WhatsApp conversation and ticket keeps the receiving Evolution integration ID; staff replies must use that same tenant-owned connection and fail closed if it is unavailable. Legacy records without an ID may use the preserved default connection. Do not backfill historical conversations or add full real-time updates.

**Why:** multiple-number routing is now in scope, and silently switching a ticket reply to another sender would violate the customer conversation context. Historical backfill and full real-time behavior were not requested.

**How to apply:** preserve the stored sender identity through ticket creation, outbound delivery, status callbacks, and retries; keep historical backfill and full real-time updates out of scope unless explicitly requested.
