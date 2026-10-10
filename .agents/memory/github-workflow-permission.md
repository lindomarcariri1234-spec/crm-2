---
name: GitHub workflow permission
description: Separate authorization needed when a GitHub integration can write repository code but cannot change workflow files
---

GitHub repository write access does not necessarily include permission to create or update files under `.github/workflows`. GitHub may return 403/404 for Git Database, Contents, and GraphQL writes even while ordinary blobs, trees, and commits succeed.

Actions settings and rerun endpoints can impose a separate `Actions: write` or repository-admin requirement; reading commits and workflow runs, or having `repo` and `workflow` scopes, does not prove those endpoints are writable.

The GitHub CLI credential may also be able to push a branch but lack permission to create a pull request; `gh pr create` can return `Resource not accessible by personal access token (createPullRequest)`. The already-connected GitHub App can have the needed PR permission even when that CLI credential does not.

**Why:** GitHub separates workflow-file, Actions-settings, workflow-rerun, and pull-request permissions. The connected OAuth authorization previously exposed `repo` but not `workflow`; separately, a healthy connection with `repo` and `workflow` can still receive 403 on Actions settings or rerun endpoints, and CLI branch-write access does not prove PR-creation access.

**How to apply:** Before changing Actions secrets/variables or rerunning a job, verify the exact endpoint is authorized and the account has repository-admin access where required. Before retrying a workflow-file push, inspect the integration's effective scopes; if it lacks `workflow`, use an already configured, appropriately scoped Git write path only transiently for the requested operation. If CLI PR creation is denied after a successful push, use the configured GitHub App connection for that PR operation. Do not force-push, persist credentials in Git configuration, or silently omit the workflow.