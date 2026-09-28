---
name: Group reservation passenger validation
description: The positional passenger-count invariant for group reservations and how sparse form state can bypass naive validation.
---

Validate all expected companion slots explicitly against the selected trip quantity. Do not rely on `array.every()` over user-edited arrays: it skips sparse holes. If quantity changes after companion entry, re-check the required positions before allowing checkout; direct submit should also guard the same invariant.

**Why:** A user can fill a later passenger before an earlier one, leaving a sparse array that passes `every()` even though the group is incomplete. Increasing quantity during review can create the same incomplete state.

**How to apply:** For a group of `qty` passengers, materialize or otherwise check each index from `0` through `qty - 2`; require a non-empty name for every slot and keep payload order positional.