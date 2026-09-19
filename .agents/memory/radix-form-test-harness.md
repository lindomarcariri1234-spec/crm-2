---
name: Radix form test harness
description: DOM harness requirements for controlled inputs and Radix Select components
---

In frontend component tests using the shared DOM harness, mock `HTMLElement.prototype.scrollIntoView` before rendering Radix Select components. For controlled text inputs, set the value through the native `HTMLInputElement` setter and dispatch `input`/`change` inside the harness's act helper.

**Why:** The simulated DOM does not provide `scrollIntoView`, and directly assigning `.value` can bypass React's controlled-input change tracking, causing tests to exercise local validation instead of the mutation path.

**How to apply:** Add the harness shim in test setup and use the native setter only where a test needs to populate a controlled input before clicking a submit action.