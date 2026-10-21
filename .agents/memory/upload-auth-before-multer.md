---
name: Authenticate before buffering uploads
description: Place authentication before multipart parsers that retain file contents in process memory.
---

Authenticate multipart requests before invoking Multer or another in-memory file parser.

**Why:** An unauthenticated request can otherwise force the server to allocate the route's full file-size limit in memory before authorization rejects it, enabling avoidable memory exhaustion.

**How to apply:** Put the session/role guard earlier in each Express route chain than the parser, then verify with an unauthenticated multipart request that would otherwise trigger parsing or file validation.
