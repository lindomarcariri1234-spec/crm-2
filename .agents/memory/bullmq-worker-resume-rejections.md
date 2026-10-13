---
name: BullMQ worker resume rejections
description: BullMQ Worker.run() rejection handling when resuming a worker after the loop stopped.
---

In BullMQ 5.81.5, `Worker.resume()` starts `this.run()` without awaiting or attaching a rejection handler when the previous worker loop is no longer running. A Redis quota failure during that restart can therefore become a process-level unhandled rejection instead of reaching the worker's `error` event.

**Why:** Production logs showed an unhandled rejection immediately before the daily-limit circuit reopened after each recovery attempt.

**How to apply:** When attaching Redis circuit handling to BullMQ workers, wrap `run()` so rejected promises are emitted as worker `error` events; verify this behavior against the installed BullMQ version when upgrading.
