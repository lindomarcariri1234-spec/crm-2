---
name: GitHub API push limits
description: Operational constraints when publishing repository trees through the authenticated GitHub integration
---

When a repository must be updated through the authenticated GitHub API rather than `git push`, do not upload every changed file as an individual blob in a burst. The integration can apply a secondary rate limit even when the GitHub core quota is available. Large generated artifacts can also exceed the integration's request limit; they need a separate upload strategy or should remain at the remote version only with explicit disclosure.

**Why:** A repository push can otherwise leave many orphaned Git objects, fail after partial uploads, or be unable to publish a generated artifact even though the branch reference is still safe.

**How to apply:** Confirm the remote ref is an ancestor or otherwise safely mergeable, use tree entries with inline text content where practical, pace the smaller binary blob uploads, build the tree in small batches, and compare the ref again immediately before a non-force update.