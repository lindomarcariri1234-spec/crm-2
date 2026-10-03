---
name: PNPM workspace package adds
description: Avoid unrelated workspace policy and lockfile churn from scoped dependency additions.
---

**Rule:** After a scoped `pnpm add` in this workspace, inspect both `pnpm-workspace.yaml` and `pnpm-lock.yaml`. The package operation can normalize workspace formatting, remove comments, pin catalog ranges, or refresh unrelated peer snapshots. Keep only the intended importer changes and restore unrelated configuration.

**Why:** A routine Expo type dependency addition rewrote workspace comments and catalog metadata and produced unrelated lockfile peer updates, obscuring the workspace's supply-chain policy.

**How to apply:** Review the complete diff immediately after package changes, preserve the existing minimum-release-age policy and catalog ranges, and rely on the pinned CI install to validate the focused lockfile changes.