---
name: GitHub CLI authentication bridge
description: Distinguishes GitHub API connector access from Git remote push authentication in this workspace
---

**Rule:** A working GitHub API connection does not prove that Git remotes can push. If Git rejects the credential even after the source-control connection is active, do not flatten or reconstruct a local commit history through ad-hoc API writes; stop and restore a supported Git push authorization.

**Why:** In this workspace, GitHub API reads succeeded while Git push continued to return an invalid-credential error, and the normal reauthorization flow was unavailable for the source-control connection.

**How to apply:** Verify the Git remote push path independently before opening a release PR or deploying. Preserve all local commits until the authenticated push succeeds.
