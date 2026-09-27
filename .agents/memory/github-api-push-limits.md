---
name: GitHub API push limits
description: Operational constraints when publishing repository trees through the authenticated GitHub integration
---

When local `git push` has no write authentication, use the installed GitHub integration instead of asking for a token. For public commits created through the API, use a non-personal agent identity for both author and committer so local email is not exposed. Avoid uploading every changed file as an individual blob in a burst: the integration can hit a Cloudflare secondary block even when the GitHub core quota is available. One aggregate `git/trees` request with inline content works for small patches; large generated artifacts need a separate strategy or should remain at the remote version only with explicit disclosure.

The GitHub API accepts reading a branch through `/git/ref/heads/main` in this integration, but updating it requires the plural endpoint `/git/refs/heads/main`; using the singular path for `PATCH` returns 404.

The workspace `GITHUB_TOKEN` may belong to a different GitHub user without write access even when the managed GitHub connection has admin access to the repository; verify the connection before retrying shell authentication.

An added Replit GitHub connection that can access REST endpoints does not necessarily authenticate the workspace's `git push`. A single API snapshot commit can preserve the final tree and remote parent while omitting local-only commit ancestry.

**Why:** Git transport authentication and connector API authorization are separate. Partial API uploads can leave orphaned objects or fail before the branch moves. A public commit made with the local identity can expose its personal email; flattening the commit graph would not satisfy a request to preserve history.

**How to apply:** If `git push` fails authentication and the user asked to preserve commit history, pause before creating an API snapshot. Otherwise confirm the remote ref and branch protection, create the tree from that exact base, compare it to the verified local tree, and re-read the ref immediately before a non-force update. Prefer an aggregate tree with inline text and a non-personal author and committer. Pace smaller mutations. For identical large generated files, upload one base64 Git blob and reuse its SHA; if the proxy limit prevents that, preserve the remote blob explicitly rather than publishing a partial tree.

**Operational note:** In this workspace, shell output can collapse the tab between `git diff --name-status` fields; use `git diff --name-only` for API path enumeration and detect deletions from the filesystem.
