---
name: Evolution webhook/session separation
description: Keep Evolution's inbound webhook setup distinct from WhatsApp device-session connectivity.
---

Attempt Evolution's inbound webhook setup independently from checking the WhatsApp connection state. A `close` session result should mark the session disconnected, but must not by itself determine whether webhook configuration succeeded; report the result of the webhook endpoint separately.

Pairing a disconnected device requires an explicit administrator action and a human scan of the temporary QR returned by Evolution's `GET /instance/connect/{instanceName}` endpoint. Keep the QR ephemeral: do not persist it or include it in logs.

Evolution API v2.3.7's connect response includes a `code` pairing payload as well as `base64` image data. If no valid base64 image is present, render a QR image transiently from the bounded `code` value; return it only to the authorized administrator with `Cache-Control: private, no-store`. Never log or persist the pairing code.

For Evolution API v2.3.7, `POST /webhook/set/{instanceName}` requires a `{ webhook: { enabled, url, events, base64, byEvents } }` body, while `POST /message/sendText/{instanceName}` requires `{ number, text }`. Flat webhook bodies and nested `textMessage` bodies are rejected with HTTP 400. A `404` from the connection-state endpoint means the instance was not found, not that its WhatsApp session is closed. Use the exact tagged Evolution API schemas, not generic or current docs, when checking versioned requests.

**Why:** Session state, webhook configuration, and device pairing are separate operations. A QR contains a temporary pairing credential and cannot connect the device without its owner scanning it. Version-specific payload-shape errors can also reject webhook or send requests while the session-state check succeeds.

**How to apply:** In save flows, run connection-state checks and authenticated webhook setup independently. Treat only the connection-state response as proof of a connected WhatsApp session, and only the webhook endpoint response as proof that receiving is configured. Match request bodies to the exact tagged Evolution API schemas and assert the serialized bodies in tests. When pairing is requested, return only a validated QR image to an authorized administrator with `Cache-Control: private, no-store`; if base64 is unavailable, bound and render the documented `code` payload in memory. Keep the QR and code out of logs and persistence, and never imply that generating it completed the connection.

An Evolution endpoint responding from the development workspace does not prove it is reachable from the published runtime. Do not reset credentials or device sessions based only on a network failure.

**Why:** Production pairing requests have failed after the connect-timeout window while the same public host responded normally from development; the generic fetch error hid the distinction from an authentication or session error.

**How to apply:** Classify transport failures by safe error names/cause codes, without returning or logging raw provider exceptions, credentials, or QR content. Verify the published path separately before claiming the WhatsApp connection is restored.
