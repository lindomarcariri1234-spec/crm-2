---
name: API entrypoint formatting
description: Preserve the existing formatting baseline when making focused changes to API startup code.
---

For small changes to the API server entrypoint, avoid running Prettier over the entire file unless the task includes a full formatting pass. Check the existing baseline first and review formatting only in the changed sections.

**Why:** The entrypoint already differs from whole-file Prettier output, so formatting it wholesale creates unrelated changes that obscure the startup behavior being reviewed.

**How to apply:** For focused edits, compare formatter output against the existing baseline, keep new helper and test files formatted, and run `git diff --check`.