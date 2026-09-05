---
name: Vercel external storefront assets
description: Keeps externally rewritten storefront HTML compatible with Vercel asset routing.
---

When Vercel serves storefront HTML from the Replit runtime through an external rewrite, hashed JavaScript and CSS assets must be forwarded to that same runtime before the generic SPA fallback. Otherwise the fallback can return `index.html` for `/assets/*`, producing strict MIME-type errors and a blank page.

**Why:** The storefront HTML and its generated asset filenames come from the same build on the Replit runtime. Serving HTML from one runtime while resolving assets through a catch-all rewrite can return HTML with `text/html` for module requests.

**How to apply:** Keep an explicit `/assets/:path*` external rewrite ahead of `/:path* -> /index.html`, and verify at least one generated `.js` and `.css` asset returns its correct content type.