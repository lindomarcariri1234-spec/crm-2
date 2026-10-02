---
name: Unified WhatsApp timeline send path
description: Consent and tenant-safety rationale for sending WhatsApp messages from the client communication timeline.
---

The client communication timeline should continue to send WhatsApp messages through the normal tenant-scoped client message route, which validates the client and dispatches through the consent-aware outbound service. Keep the chatbot conversation reply route for the AI Inbox workflow.

**Why:** The chatbot reply route validates the conversation's tenant and opt-out status, then sends to the server-owned session phone. Using it from the generic client timeline would bypass the selected client's opt-in check and alter the chatbot handoff state.

**How to apply:** If a future timeline feature sends directly into a chatbot conversation, validate the conversation/client relationship and current client consent server-side under the tenant. Never accept the WhatsApp phone number from the browser.