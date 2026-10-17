---
name: Evolution webhook/session separation
description: Keep Evolution's inbound webhook setup distinct from WhatsApp device-session connectivity.
---

Attempt Evolution's inbound webhook setup independently from checking the WhatsApp connection state. A `close` session result should mark the session disconnected, but must not by itself determine whether webhook configuration succeeded; report the result of the webhook endpoint separately.

**Why:** Session state and webhook configuration are separate provider operations, and gating one on the other can leave inbound receiving unconfigured even when the webhook endpoint would accept the settings.

**How to apply:** In save flows, run the connection-state check and authenticated webhook setup independently. Treat only the connection-state response as proof of a connected WhatsApp session, and only the webhook endpoint response as proof that receiving is configured.
