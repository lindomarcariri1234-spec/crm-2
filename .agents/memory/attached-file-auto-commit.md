---
name: Attached files can be auto-committed
description: Prevent user-uploaded chat attachments from being published accidentally during Git work.
---

When a Git task follows a user file attachment, inspect the latest commit and
the attachment path before pushing. A clean working tree does not prove the
attachment is absent from the branch.

**Why:** Replit can create an automatic attachment commit as a task begins.
That commit may be added after the initial status check, so a routine push can
publish the file even when no one manually staged it.

**How to apply:** Before any push, compare `HEAD` with its parent and check
whether the attached path is tracked. If an unwanted attachment is already
reachable, preserve a backup first and obtain explicit consent before rewriting
published history; removing it only from the current tip is not enough.