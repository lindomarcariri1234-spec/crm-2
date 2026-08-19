---
name: SSRF for tenant-supplied provider base URLs
description: How to safely make server-side HTTP calls to URLs that a tenant admin controls (e.g. per-tenant AI provider base URL)
---

When a tenant admin can configure a base URL that the server then calls (per-tenant
AI provider config, webhooks, etc.), a plain pre-flight DNS check is NOT enough.

The rule: validate up front AND enforce at connection time.

**Why:** A pre-flight `dns.lookup` that passes, followed by `fetch`, leaves a
DNS-rebinding / TOCTOU window — the hostname can resolve to a public IP during
validation and to a private/metadata IP (e.g. 169.254.169.254) during the actual
socket connect. The pre-check alone is bypassable.

**How to apply (in `artifacts/api-server/src/lib/ai-client.ts`):**
- `assertSafeUrl`: require HTTPS, reject literal private/reserved IPs, do an
  initial resolve check, and force `redirect: "error"` on the fetch.
- Connection-time guard: build an undici `Agent` with `connect.lookup` that
  re-resolves and rejects private/reserved addresses, binding the check to the
  real socket. undici skips `lookup` for literal IPs, so `assertSafeUrl` is what
  catches those.
- Use undici's OWN `fetch` (`import { fetch } from "undici"`), NOT Node's global
  fetch. Node 24's built-in undici is a different instance and rejects an
  external dispatcher with "invalid onRequestStart method". Pass the Agent as
  `dispatcher` to undici's fetch, then hand that fetch to the OpenAI SDK's
  `fetch` option.
- Sanitize provider/network errors before returning/logging them — never echo
  raw response bodies from an arbitrary endpoint back to the client or audit log.

**IPv6 literal classification (a real bypass that was shipped once):** a naive
private-IP check is bypassable with IPv4-in-IPv6 literals. `127.0.0.1` can be
written `::ffff:127.0.0.1`, `::ffff:7f00:1` (hex), `::7f00:1` (compatible), or
NAT64 `64:ff9b::7f00:1`, and `URL.hostname` keeps the `[ ]` brackets so
`net.isIP` returns 0 and the host gets (wrongly) sent to DNS. The rule: strip
brackets, then canonicalize ANY IPv6 textual form to its 16 bytes and detect
embedded IPv4 (mapped `::ffff:0:0/96`, compatible `::/96`, NAT64 `64:ff9b::/96`)
by recursing on the embedded IPv4 — never match by string prefix/regex. Keep the
SSRF unit tests as regression coverage for these encodings.

**Related trap — wrong-provider key leak:** the OpenAI SDK defaults `baseURL` to
api.openai.com when none is given. A "custom"/compatible provider with an empty
base URL therefore silently sends the tenant's key to OpenAI. Guard centrally in
the client builder (throw before constructing the client) so every call site —
including the Test Connection endpoint — is protected, not just the save path.
