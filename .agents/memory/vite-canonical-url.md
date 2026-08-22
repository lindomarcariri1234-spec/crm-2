---
name: Vite canonical URL handling
description: Why the static HTML fallback needs an absolute canonical URL in this Vite artifact.
---

Use an absolute URL for the static fallback canonical tag in the Vite HTML shell. The application can replace it with the current agency URL at runtime or on the server.

**Why:** Vite's HTML asset processing treats `href="/"` on the canonical link as a local filesystem asset and attempts to read the project directory, failing the production build with `EISDIR`.

**How to apply:** Keep the generic fallback canonical absolute (for example, the configured public site origin). When adding or editing canonical tags, run the Vite production build rather than relying only on the dev server.