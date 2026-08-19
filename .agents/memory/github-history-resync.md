---
name: GitHub history resync
description: Safe recovery when Replit and GitHub have equivalent files but unrelated commit histories.
---

After rebuilding Git history with fast-export/fast-import, do not leave the original local `main` tracking the rebuilt remote history. Preserve both tips, push with a lease, verify that the local and remote tree hashes are identical, then move local `main` to the fetched remote tip and confirm the ahead/behind counts are both zero.

**Why:** A clean export can change commit IDs while preserving every file. If local `main` stays on the original IDs, Replit reports hundreds of commits both ahead and behind and its Git validation can fail with `INVALID_STATE`.

**How to apply:** Create backup refs/bundles first. Compare `HEAD^{tree}` with `origin/main^{tree}` before any reset. Keep credentials out of remote URLs; use an environment-backed credential helper or temporary askpass flow. Finish with fetch, push dry-run, `git fsck`, and zero divergence.