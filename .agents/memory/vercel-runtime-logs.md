---
name: Vercel runtime log query limit
description: Practical constraint when fetching Vercel function logs through the REST connector.
---

The Vercel deployment runtime-log endpoint can run for more than five minutes when requested without filters and return an “Exceeded query duration limit of 5 minutes” record instead of useful rows. Avoid repeating a broad call. Prefer short time windows and deployment, status, or text filters through `vercel logs` when an authenticated CLI is available, or validate a narrow public health route and use available build events.

**Why:** A broad runtime-log request during production verification hit the service's five-minute query ceiling, while deployment status, build events, and a direct health check were accessible.

**How to apply:** For production function failures, query logs with the smallest time range and filters possible. If no filtered interface is available, don't loop on the same unfiltered request; report that runtime logs are inaccessible and use deployment metadata and public endpoint checks.