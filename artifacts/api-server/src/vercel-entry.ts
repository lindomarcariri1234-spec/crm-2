// Force IPv4 for all outbound DNS lookups, same rationale as src/index.ts.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

// Patch globalThis.fetch for UploadThing CDN uploads — must be the first
// module imported so the patch is in place before any uploadthing module
// is first required. See lib/fetch-patch.ts for details. This mirrors the
// exact contract enforced by build.mjs's assertFetchPatchOrder() for the
// Replit bundle; build-vercel.mjs enforces the same contract here.
import { FETCH_PATCH_APPLIED } from "./lib/fetch-patch";
import { logger } from "./lib/logger";

logger.info({ fetchPatchApplied: FETCH_PATCH_APPLIED }, "[vercel] fetch-patch active");

// NOTE: `app` is intentionally loaded via a dynamic import below, AFTER the
// fetch-patch has already run — do NOT add a static `import app from "./app"`
// here. app.ts transitively loads uploadthing, which captures globalThis.fetch
// by value during module evaluation; the dynamic import guarantees ordering.
//
// On Vercel there is no long-running process: no app.listen(), no
// applyMigrations() (done at build time by scripts/vercel-migrate.ts), no
// cron scheduling (done via the secured /api/cron/:job endpoints in
// src/routes/cron.ts + vercel.json's `crons`), and no BullMQ worker startup
// (ENABLE_WORKERS must be "false" — queue producers fall back to direct
// sends; see getBullMQQueueConnection in lib/redis.ts).
const { default: app } = await import("./app");

export default app;
