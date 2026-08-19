---
name: logger.warn vs console.warn in tests
description: Production code uses logger.warn (src/lib/logger); vi.spyOn(console, "warn") misses it; must mock the logger module
---

## Rule
All API server production code uses `logger` from `../../lib/logger` (a pino logger instance). `vi.spyOn(console, "warn")` will NOT capture these calls — it only intercepts `console.warn`.

**Why:** The project uses pino-based structured logging, not bare `console.*`. The logger writes to stdout in JSON format (production) or pretty format (dev) via pino, bypassing the `console` object entirely.

**How to apply:**
When a test needs to verify that a warning was logged, mock the logger module instead of spying on console:

```ts
const mockLogWarn = vi.fn();
vi.mock("../lib/logger.js", () => ({
  logger: {
    warn:  (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    info:  vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));
```

Use a closure (`(...args) => mockLogWarn(...args)`) rather than `{ warn: mockLogWarn }` directly, because `vi.mock` factories are hoisted before variable initialization, so the direct value would be `undefined`. The closure captures by reference and resolves `mockLogWarn` at call time.

Then assert: `expect(mockLogWarn).toHaveBeenCalled()`. `vi.clearAllMocks()` in `beforeEach` clears the mock automatically.
