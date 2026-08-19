---
name: Public repository remediation
description: Safety rule for making a repository public after credentials were committed.
---

**Rule:** Revoke and replace every exposed credential before making a repository public, then remove sensitive tracked files and rewrite the public branch so the compromised blobs are unreachable.

**Why:** Force-pushing a clean history does not invalidate credentials that were already copied, cached, cloned, or retained temporarily by a hosting provider.

**How to apply:** Validate replacement credentials without logging them, verify the sanitized branch before publication, and use a credential-free remote URL plus managed OAuth where available.