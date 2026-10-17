---
name: Evolution webhook/session separation
description: Keep Evolution's inbound webhook setup distinct from WhatsApp device-session connectivity.
---

Attempt Evolution's inbound webhook setup independently from checking the WhatsApp connection state. A `close` session result should mark the session disconnected, but must not by itself determine whether webhook configuration succeeded; report the result of the webhook endpoint separately.

Pairing a disconnected device requires an explicit administrator action and a human scan of the temporary QR returned by Evolution's `GET /instance/connect/{instanceName}` endpoint. Keep the QR ephemeral: do not persist it or include it in logs.

**Why:** Session state, webhook configuration, and device pairing are separate operations. A QR contains a temporary pairing credential and cannot connect the device without its owner scanning it.

**How to apply:** In save flows, run connection-state checks and authenticated webhook setup independently. Treat only the connection-state response as proof of a connected WhatsApp session, and only the webhook endpoint response as proof that receiving is configured. When pairing is requested, return only a validated QR image to an authorized administrator; never imply that generating it completed the connection.
