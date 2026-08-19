---
name: Metro parser remediation
description: Compatibility principle for an unpatched transitive image parser.
---

When a transitive image parser remains exposed to disclosed denial-of-service flaws without an upstream release, preserve a vetted replacement that keeps the consuming build tool's public API intact.

**Why:** A version-only update can leave the vulnerable parser in place even though the build tool still needs its dimension-reading API. The Metro asset pipeline supplies ordinary local asset paths, while the vetted replacement parses byte buffers only.

**How to apply:** Keep the narrow compatibility patch that reads string paths into bytes before the safe parser runs. Reassess it whenever the mobile build stack changes, and remove it only after a verified upstream release eliminates the vulnerable dependency without breaking Metro's path-based call contract.