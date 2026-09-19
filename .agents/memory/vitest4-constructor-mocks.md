---
name: Vitest 4 constructor mocks
description: Vitest 4 can reject function mocks as constructors in worker-style tests.
---

When a mocked dependency is instantiated with `new`, use a constructable function or class-shaped mock rather than relying on an arrow/function mock implementation.

**Why:** Vitest 4 tightened constructor behavior, so mocks that were callable under Vitest 3 can throw `is not a constructor` during worker tests.

**How to apply:** Review test doubles for `Worker`, `Queue`, and other `new Dependency(...)` calls during Vitest 4 upgrades; preserve the mock's event and lifecycle behavior.