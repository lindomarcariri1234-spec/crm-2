---
name: Concurrent task file corruption
description: A shared route file was found mid-task with corrupted call sites (wrong identifiers/schemas) that no local edit had introduced — caused by another concurrently-running task session writing to the same file.
---

## What happened
While finishing a scoped change to one function in a heavily-shared route file
(`users.ts`), the pre-completion typecheck run suddenly failed with errors in
unrelated call sites in the same file: an undefined identifier substituted for
the correct one, a wrong Zod schema swapped in for parsing, and a `where`
lookup using the wrong column — none of which were touched by this task's
edits. A prior local typecheck run (minutes earlier) had passed clean.

**Why:** other project tasks were being actively worked on and merged into
the same repo during this session (visible via mid-conversation task-merge
notifications). A concurrent session's edit to the same file landed in a
broken/partial state on disk between this task's last read and its
pre-completion commit, and the completion flow's `git add -A && commit`
snapshotted that broken state together with this task's legitimate diff.

**How to apply:** if a typecheck/build failure right before completion shows
errors in code you never touched, don't assume you introduced it — diff the
file against the last known-good commit (`git show <prior-commit>:<path>` vs
current) to isolate exactly which hunks are actually yours vs. unexplained.
Restore the unrelated hunks to the known-good version, keep only your
intended diff, then re-verify (typecheck + build + tests) before completing.
This is most likely on files multiple in-flight tasks touch concurrently
(shared route/schema files); treat an unexplained regression there as a
race, not a self-inflicted bug, but still fix it before shipping.
