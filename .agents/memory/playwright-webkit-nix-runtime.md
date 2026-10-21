---
name: Playwright WebKit on Nix
description: WebKit's Linux browser bundle may not run against the Nix workspace's system libraries.
---

Playwright's Linux WebKit bundle expects Ubuntu-specific runtime libraries. Installing similarly named Nix packages can still leave ABI/SONAME mismatches, and headless WebKit selects its WPE backend with additional multimedia dependencies.

**Why:** Cross-browser verification in this workspace confirmed Firefox could run, but WebKit could not launch cleanly after multiple runtime-library attempts; the temporary package additions were removed rather than committed.

**How to apply:** Do not claim WebKit coverage until the actual Playwright journey passes. Prefer a CI runner with the browser dependencies supported by Playwright instead of adding one-off browser libraries to the app's Nix dependencies.
