---
name: Vercel runtime log query limit
description: Practical constraint when fetching Vercel function logs through the REST connector.
---

The Vercel deployment runtime-log endpoint can return an “Exceeded query duration limit of 5 minutes” record instead of useful rows. This can still happen when the request is scoped to a deployment and includes a short `since`/`until` window plus a `limit`; the REST endpoint may not provide effective filters for the underlying query. Do not interpret a timeout or empty result as proof that a function was not invoked.

**Why:** Both an unfiltered request and a recent-time-window request during production verification hit the service's five-minute query ceiling, while deployment status and public health checks remained accessible.

**How to apply:** Try one deployment-scoped, narrow-time query. If it still times out, do not repeat the same connector call; use another log surface or deployment metadata and safe public probes, and state explicitly when the exact request origin remains unverified.