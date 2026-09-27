---
name: Vercel canceled Git deployments
description: Recovery when the linked Vercel project cancels an automatic Git deployment before it builds
---

**Rule:** An automatic Vercel deployment can be marked `CANCELED` with no build events even when the commit changes published files. Do not infer a source or ignore-command failure from that status alone. For an explicitly requested publish, create a fresh production deployment from the verified GitHub source SHA; `forceNew=1` bypasses deployment deduplication. Redeploying the canceled deployment by its `deploymentId` may be rejected. For this linked GitHub project, `gitSource.type="github-limited"` with `repoId` failed as `git_info_fail`; the working request used `type="github"` with `org`, `repo`, `ref`, and the exact `sha`.

**Why:** In this workspace, GitHub-triggered production attempts were canceled before logs appeared, and Vercel rejected redeploying that canceled record. Creating a new deployment from the same GitHub `gitSource` started the build and reached `READY`; the source variant also matters for Git metadata resolution.

**How to apply:** Confirm the Vercel project, linked repository, branch, and exact SHA. If the automatic attempt is canceled without a build, use the Vercel integration to create a new production deployment from that Git source with `forceNew=1`, then verify the ready state and production alias.