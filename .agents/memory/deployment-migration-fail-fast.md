---
name: Deployment migration fail-fast
description: Startup behavior when database migrations fail during an HTTP deployment boot
---

Database migration failure must abort the API process before it serves normal traffic. A live process with a partially migrated schema turns the real boot error into unrelated route-level 500s and can make an Autoscale promote appear successful before requests fail.

**Why:** The deployment binds HTTP before migrations so the readiness path can respond quickly, but that makes swallowing migration errors especially dangerous: the process can remain reachable while the database is incompatible.

**How to apply:** Keep migrations asynchronous after the early bind, but rethrow migration errors into the startup-abort handler. Log the failure as a migration-or-credential startup failure, then let the deployment platform restart or reject the instance.