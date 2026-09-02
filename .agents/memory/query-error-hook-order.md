---
name: Query error branches and hook order
description: Aggregate query-error UI must not return before later React hooks in the same component.
---

Keep unconditional hooks and memo calculations ahead of any aggregate query-error return.

**Why:** A request can transition from loading/success to error during the component lifetime; returning before later hooks changes hook order and can trigger React's rendered-fewer-hooks failure.

**How to apply:** Put the error branch after every hook in the component, or render it inside the final JSX instead of using an early return.