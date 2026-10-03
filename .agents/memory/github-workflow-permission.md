---
name: GitHub workflow permission
description: Separate authorization needed when a GitHub integration can write repository code but cannot change workflow files
---

GitHub repository write access does not necessarily include permission to create or update files under `.github/workflows`. GitHub may return 403/404 for Git Database, Contents, and GraphQL writes even while ordinary blobs, trees, and commits succeed.

**Why:** The connected OAuth authorization exposed `repo` but not the separate `workflow` scope, so it could not update workflow files. A separately provisioned Git credential allowed a normal branch push; that credential must stay out of logs and persistent Git configuration.

**How to apply:** Before retrying a workflow-file push, inspect the integration's effective scopes. If it lacks `workflow`, use an already configured, appropriately scoped Git write path only transiently for the requested operation; otherwise obtain authorization that includes workflow access. Do not force-push, persist credentials in Git configuration, or silently omit the workflow.