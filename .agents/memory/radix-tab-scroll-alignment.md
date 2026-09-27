---
name: Scrollable Radix tabs
description: Prevent leading tab triggers from being clipped in horizontally scrollable mobile tab rails.
---

For a wide mobile tab rail built on the shared Radix/shadcn `TabsList`, override the primitive's centered justification with `justify-start` at the small viewport and restore centered alignment at desktop when desired. `overflow-x-auto` alone is not enough: centered flex content wider than its viewport can place the first triggers before the scroll origin.

**Why:** Browser measurements showed the leading trigger positioned far to the left while the rail had `scrollLeft === 0`; the inherited `justify-center` was centering the oversized row rather than keeping its start reachable.

**How to apply:** When adding a horizontally scrollable tab list, assert in a real browser that both its first and last triggers intersect the rail after scrolling. Avoid relying on DOM visibility checks alone.