---
name: Vitest mock call typing
description: Avoid strict TypeScript errors when tests inspect arguments captured by Vitest mocks.
---

When a test inspects `mock.calls`, give the mock an explicit function signature or cast the calls collection to an argument array before indexing it.

**Why:** An untyped `vi.fn()` can infer a zero-argument procedure, so TypeScript reports impossible tuple indexes even when the runtime mock receives arguments.

**How to apply:** Type mocks that are passed into callbacks (for example, SQL execution mocks), and use a small typed helper for repeated `mock.calls[0]?.[0]` payload assertions.