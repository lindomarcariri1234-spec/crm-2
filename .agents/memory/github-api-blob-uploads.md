---
name: GitHub API blob uploads
description: Safe way to publish large workspace files through the authenticated GitHub connector
---

When Git transport authentication is unavailable, publish commits through the GitHub Git Database API. For large tracked files, read the raw workspace text first and perform the UTF-8-to-base64 conversion inside the authenticated API call. Do not depend on a shell command's base64 stdout as the source payload.

**Why:** shell-based base64 output can be truncated or otherwise altered by the tool output boundary while still appearing successful, producing a GitHub blob that passes the API write but breaks the remote build.

**How to apply:** compare local and remote tree blob SHAs, upload only changed blobs, build a tree from the remote branch tree, create a commit with the current remote commit as parent, and update the branch without force push.