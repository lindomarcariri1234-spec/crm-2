---
name: Vercel bundle external dependencies
description: Rules for keeping the Vercel API artifact small while preserving runtime package discovery and UploadThing initialization order
---

The Vercel serverless bundle should mirror the long-running API build's external dependency policy. Large Node-compatible integrations belong in runtime dependencies, with literal imports in the conventional function entrypoint so Vercel traces and copies them.

**Why:** Bundling integrations such as spreadsheet, calendar, AI, billing, and UploadThing SDKs can push the tracked function over the provider warning threshold. UploadThing also must not initialize before the fetch patch.

**How to apply:** When adding a heavy integration, update the Vercel `EXTERNAL` list and its trace imports together. Validate the fetch-patch marker and runtime import; do not require the UploadThing implementation to be bundled.