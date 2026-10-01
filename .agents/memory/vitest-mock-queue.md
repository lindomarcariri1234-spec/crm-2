---
name: Vitest one-time mock queue isolation
description: Avoid leaking one-time mock results between tests with early returns.
---

`vi.clearAllMocks()` clears call history but does not consume or clear queued `mockResolvedValueOnce` and `mockImplementationOnce` behaviors. A test that returns early can leave queued responses for the next test.

**Why:** Leaked once-mocks make later tests depend on execution order and can produce unrelated endpoint failures.

**How to apply:** Queue only the calls the handler will reach, ensure each once-mock is consumed, and reset mock implementations/queues between test cases that can exit early.