---
name: Browser keyboard verification
description: Use a real browser when validating native keyboard activation, tab order, or focus after controls disappear.
---

For keyboard behavior that relies on native button or input semantics, exercise the real component in Chromium with Playwright. Dispatching clicks in a DOM harness does not verify browser Tab order, Enter/Space activation, or where focus goes when the focused control is removed.

**Why:** A component can pass click-based unit tests while keyboard traversal or focus recovery still fails in the browser.

**How to apply:** Add a focused Playwright fixture for the actual component and assert focus, keyboard activation, accessible state, and focus recovery after UI transitions.
