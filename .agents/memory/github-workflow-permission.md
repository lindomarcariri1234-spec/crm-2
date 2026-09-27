---
name: GitHub workflow permission
description: Separate authorization needed when a GitHub integration can write repository code but cannot change workflow files
---

GitHub repository write access does not necessarily include permission to create or update files under `.github/workflows`. GitHub may return 403/404 for Git Database, Contents, and GraphQL writes even while ordinary blobs, trees, and commits succeed.

**Why:** The connected OAuth authorization exposed `repo` but not the separate `workflow` scope; ordinary application changes published successfully, while the CI workflow remained blocked.

**How to apply:** Before retrying a workflow-file push, inspect the integration's effective scopes. Do not force-push or silently omit the workflow; obtain an authorization that explicitly includes workflow access, then publish the remaining delta against the current branch SHA.