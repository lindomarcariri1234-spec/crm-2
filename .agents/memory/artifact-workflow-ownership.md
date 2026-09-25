---
name: Artifact workflow ownership
description: Prevent duplicate processes when a registered artifact also appears in the aggregate Project workflow.
---

Registered artifact workflows own their own long-running process. The aggregate Project workflow must not call `workflow.run` for the same artifact, or two supervisors can start the same server and collide on its configured port.

**Why:** The duplicate Expo launch left an older process alive while the direct artifact workflow restarted, producing a misleading `EADDRINUSE` on the expected mobile preview port.

**How to apply:** When an artifact has its own configured workflow, keep it out of the Project workflow task list. After removing a duplicate, restart the artifact workflow and clean up any orphaned process from the previous aggregate run.