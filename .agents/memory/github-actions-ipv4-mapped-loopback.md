---
name: GitHub Actions IPv4-mapped loopback
description: Keep client IP values stable across local Express tests and GitHub-hosted runners.
---

Use the shared canonical client-IP helper for queue and audit payloads instead of passing `req.ip` through directly.

**Why:** Express on GitHub-hosted runners can report loopback as the IPv4-mapped IPv6 literal `::ffff:127.0.0.1`, while local test servers may report `127.0.0.1`. Directly serializing `req.ip` makes otherwise identical jobs and their assertions environment-dependent.

**How to apply:** When adding a payload that records an originating IP, call the canonical helper already used by the API route layer. It normalizes proxy and mapped-address behavior consistently.