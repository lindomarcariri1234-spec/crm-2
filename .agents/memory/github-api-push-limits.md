---
name: GitHub API push limits
description: Operational constraints when publishing repository trees through the authenticated GitHub integration
---

When a repository must be updated through the authenticated GitHub API rather than `git push`, do not upload every changed file as an individual blob in a burst. The integration can apply a Cloudflare secondary block even when the GitHub core quota is full. A single aggregate `git/trees` request with inline content can succeed where repeated blob/tree mutations are blocked. Large generated artifacts can also exceed the integration's request limit; they need a separate upload strategy or should remain at the remote version only with explicit disclosure.

The GitHub API accepts reading a branch through `/git/ref/heads/main` in this integration, but updating it requires the plural endpoint `/git/refs/heads/main`; using the singular path for `PATCH` returns 404.

The workspace `GITHUB_TOKEN` may belong to a different GitHub user without write access even when the managed GitHub connection has admin access to the repository; verify the connection before retrying shell authentication.

**Why:** A repository push can otherwise leave many orphaned Git objects, fail after partial uploads, or be unable to publish a generated artifact even though the branch reference is still safe.

**How to apply:** Confirm the remote ref is an ancestor or otherwise safely mergeable, prefer one aggregate tree when the request fits, use tree entries with inline text content where practical, pace smaller mutations, and compare the ref again immediately before a non-force update. For identical large generated files, upload one base64 Git blob and reuse its SHA in every tree path instead of transmitting duplicate payloads. If a generated file still exceeds the proxy limit, preserve its remote blob explicitly rather than creating a partial ref.

**Operational note:** In this workspace, shell output can collapse the tab between `git diff --name-status` fields; use `git diff --name-only` for API path enumeration and detect deletions from the filesystem.

An added Replit GitHub connection that can access REST endpoints does not necessarily authenticate the workspace's `git push`. A single API snapshot commit can preserve the final tree and remote parent while omitting local-only commit ancestry.

**Why:** Git transport authentication and connector API authorization are separate; flattening the commit graph would not satisfy a request to publish pending commits.

**How to apply:** If `git push` fails authentication and the user asked to preserve commit history, pause before creating an API snapshot commit. Resume with normal Git authentication, or get explicit approval for a snapshot that does not transfer local-only commits.