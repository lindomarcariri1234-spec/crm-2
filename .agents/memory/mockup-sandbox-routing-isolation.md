---
name: Mockup sandbox routing isolation
description: Routing-hook identity issue when extracting app components into isolated previews.
---

When an extracted component in the mockup sandbox directly imports `wouter`, its router hook can resolve against a separate React context and fail with an invalid hook or `useContext` error. Replace navigation only inside the preview with a local `window.location.hash` shim; do not import the production router.

**Why:** In the isolated preview, `useLocation` failed while React state hooks from the sandbox worked after routing was replaced locally.

**How to apply:** During extraction, search the page and copied shared components for `wouter`; keep all preview navigation local to the sandbox.