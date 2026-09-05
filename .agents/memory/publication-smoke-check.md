---
name: Publication smoke checks
description: How to run a post-start publication check when the platform has no postDeploy hook
---

Replit does not provide a `postDeploy` hook in `.replit`; production publication checks must run from the deployed process after it binds locally, and the check should target the deployment service's current primary URL.

**Why:** A build hook runs before the new deployment is serving, while a check of the old public URL can falsely validate the previous release.

**How to apply:** Start the production server, wait for its local health endpoint to become healthy, then check the configured public storefront and its `/api/healthz` endpoint. Fail startup with named checks when the public response, expected title marker, publication version, HTTP status, or health payload is wrong.

The storefront build embeds the current source revision as a publication marker. CI compares the public marker with its commit SHA, while the Replit production launcher compares it with the local artifact before accepting the public URL. A missing build identity is a hard error rather than an `"unknown"` fallback.

**Why:** A healthy HTTP response and the expected page title can still come from the previous deployment when a domain alias has not switched yet; accepting an unknown marker would preserve that false-positive path.

**How to apply:** Keep the marker deterministic across CI, Vercel, and Replit builds. The frontend build must write the same revision to its HTML marker and a local metadata file; the Replit launcher reads that metadata, validates the HTML, and forwards the revision to the API child process. Pass the expected revision explicitly in external smoke checks.

Launcher subprocess tests must use a dedicated port and injectable fixture paths; the
workspace API may already be healthy on port 8080 and otherwise creates a false
readiness result.

**Why:** A test that accidentally probes the shared development API can pass the
local-health phase without ever starting its fixture process.

**How to apply:** Set an isolated `PORT` and override only the index/API paths in
the subprocess environment; keep the production defaults unchanged.