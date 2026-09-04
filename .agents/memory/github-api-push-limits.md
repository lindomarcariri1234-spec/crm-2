---
name: GitHub API push limits
description: Operational constraints when publishing repository trees through the authenticated GitHub integration
---

When a repository must be updated through the authenticated GitHub API rather than `git push`, do not upload every changed file as an individual blob in a burst. The integration can apply a Cloudflare secondary block even when the GitHub core quota is full. A single aggregate `git/trees` request with inline content can succeed where repeated blob/tree mutations are blocked. Large generated artifacts can also exceed the integration's request limit; they need a separate upload strategy or should remain at the remote version only with explicit disclosure.

The GitHub API accepts reading a branch through `/git/ref/heads/main` in this integration, but updating it requires the plural endpoint `/git/refs/heads/main`; using the singular path for `PATCH` returns 404.

**Why:** A repository push can otherwise leave many orphaned Git objects, fail after partial uploads, or be unable to publish a generated artifact even though the branch reference is still safe.

**How to apply:** Confirm the remote ref is an ancestor or otherwise safely mergeable, prefer one aggregate tree when the request fits, use tree entries with inline text content where practical, pace smaller mutations, and compare the ref again immediately before a non-force update. For identical large generated files, upload one base64 Git blob and reuse its SHA in every tree path instead of transmitting duplicate payloads. If a generated file still exceeds the proxy limit, preserve its remote blob explicitly rather than creating a partial ref.