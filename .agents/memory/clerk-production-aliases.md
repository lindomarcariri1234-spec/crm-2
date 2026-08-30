---
name: Clerk production aliases
description: How to handle production access through shared hosting aliases that Clerk refuses as domains.
---

Clerk production instances can reject shared platform hostnames such as `*.vercel.app`, even when a Frontend API proxy is already available. Do not try to register such an alias as a satellite domain after the API reports it unsupported. Redirect the alias to the registered custom production domain before Clerk initializes, preserving the path and query string.

**Why:** Clerk validates production origins and explicitly refuses `*.vercel.app` domain registration. On an unregistered alias, email fields may still render while social providers disappear, which can look like a frontend regression.

**How to apply:** When the same production bundle is reachable through a platform alias and a registered custom domain, canonicalize the alias at the earliest browser entrypoint (or with a verified edge redirect). Confirm the deployed bundle actually contains the redirect because Vercel may skip frontend-only commits as “Not affected.”