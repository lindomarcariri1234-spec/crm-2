---
name: Pino HTTP error serializers
description: Keep SDK error messages and payloads out of pino-http request logs.
---

**Rule:** Apply the shared safe error serializers to both the base Pino logger and every `pinoHttp({ serializers })` configuration.

**Why:** pino-http can use its own `err` serializer for `req.log` calls; a serializer configured only on the base logger did not prevent a synthetic secret in the error message, stack, and response object from reaching request logs.

**How to apply:** When adding or changing pino-http middleware, spread the shared safe serializers alongside request/response serializers and test the serialized output from an actual `req.log` call.