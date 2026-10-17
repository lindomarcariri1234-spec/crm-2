---
name: Evolution webhook/session separation
description: Keep Evolution's inbound webhook setup distinct from WhatsApp device-session connectivity.
---

Attempt Evolution's inbound webhook setup independently from checking the WhatsApp connection state. A `close` session result should mark the session disconnected, but must not by itself determine whether webhook configuration succeeded; report the result of the webhook endpoint separately.

Pairing a disconnected device requires an explicit administrator action and a human scan of the temporary QR returned by Evolution's `GET /instance/connect/{instanceName}` endpoint. Keep the QR ephemeral: do not persist it or include it in logs.

For the published Evolution API v2.3.7 contract, `POST /webhook/set/{instanceName}` takes a flat body (`enabled`, `url`, `events`, `base64`), while `POST /message/sendText/{instanceName}` takes `{ number, textMessage: { text } }`. A `404` from the connection-state endpoint means the instance was not found, not that its WhatsApp session is closed. The general API-reference introduction may describe EvoAI APIs; use the Evolution API endpoint specs for these calls.

**Why:** Session state, webhook configuration, and device pairing are separate operations. A QR contains a temporary pairing credential and cannot connect the device without its owner scanning it.

**How to apply:** In save flows, run connection-state checks and authenticated webhook setup independently. Treat only the connection-state response as proof of a connected WhatsApp session, and only the webhook endpoint response as proof that receiving is configured. Match the payloads and status interpretation to the exact Evolution API version. When pairing is requested, return only a validated QR image to an authorized administrator; never imply that generating it completed the connection.

An Evolution endpoint responding from the development workspace does not prove it is reachable from the published runtime. Do not reset credentials or device sessions based only on a network failure.

**Why:** Production pairing requests have failed after the connect-timeout window while the same public host responded normally from development; the generic fetch error hid the distinction from an authentication or session error.

**How to apply:** Classify transport failures by safe error names/cause codes, without returning or logging raw provider exceptions, credentials, or QR content. Verify the published path separately before claiming the WhatsApp connection is restored.
