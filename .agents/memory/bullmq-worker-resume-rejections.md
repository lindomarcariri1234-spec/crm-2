---
name: BullMQ worker resume rejections
description: BullMQ Worker.run() rejection handling and quota-circuit recovery validation after resuming.
---

In BullMQ 5.81.5, `Worker.resume()` starts `this.run()` without awaiting or attaching a rejection handler when the previous worker loop is no longer running. A Redis quota failure during that restart can therefore become a process-level unhandled rejection instead of reaching the worker's `error` event.

For Redis daily-limit recovery, keep the circuit open during a short validation window after resuming workers. A successful probe does not prove that the workers' asynchronous polling commands will succeed; errors can arrive tens of milliseconds later. Upstash REST `INFO` may return HTTP 400 at quota exhaustion, and a successful response may omit the daily request counter. Only treat an explicit quota error as exhausted; when telemetry is unavailable, fall back to a Redis command probe and rely on the worker validation window rather than treating a missing counter as zero or blocking recovery indefinitely.

**Why:** Production logs showed an unhandled rejection immediately before the daily-limit circuit reopened after each recovery attempt. The recovery probe also appeared successful before workers rejected quota-limited commands almost immediately after resuming.

**How to apply:** When attaching Redis circuit handling to BullMQ workers, wrap `run()` so rejected promises are emitted as worker `error` events; keep the circuit open briefly after resuming and re-pause on a quota error during that window. Verify the behavior against the installed BullMQ version when upgrading.
