/**
 * Vercel build-time migration script.
 *
 * On Replit, migrations/seed/credential-backfill run once per boot from
 * inside the long-running process (src/index.ts's applyMigrations()). Vercel
 * has no equivalent boot hook for serverless functions — this script performs
 * the same three steps once, during `vercel.json`'s buildCommand, against
 * whatever DATABASE_URL is configured for that Vercel environment
 * (Production / Preview).
 *
 * The workspace package exports point directly to TypeScript source, so the
 * Vercel esbuild runner does not need a separate workspace-lib TypeScript
 * prebuild. Run this before bundling the API so a broken migration fails the
 * build loudly instead of deploying against a stale schema.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@workspace/db";
import { seedPlansIfMissing } from "../lib/seed-plans";
import { backfillEncryptedCredentials } from "../lib/credential-backfill";

const __dirnameEsm = path.dirname(fileURLToPath(import.meta.url));
// This script lives at artifacts/api-server/src/scripts/vercel-migrate.ts
// (or its esbuild output at the same relative depth) — walk up to the repo
// root then down to lib/db/drizzle, rather than depending on dist layout.
const repoRoot = path.resolve(__dirnameEsm, "../../../..");
const migrationsFolder = path.resolve(repoRoot, "lib/db/drizzle");

export async function runVercelMigration(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "[vercel-migrate] DATABASE_URL is not set for this Vercel environment. " +
      "Add it in the Vercel project's Environment Variables before deploying.",
    );
  }
  if (!process.env["CREDENTIAL_ENCRYPTION_KEY"]) {
    throw new Error(
      "[vercel-migrate] CREDENTIAL_ENCRYPTION_KEY is not set — required before " +
      "backfillEncryptedCredentials() can run.",
    );
  }

  console.log(`[vercel-migrate] Applying migrations from ${migrationsFolder}`);
  await runMigrations(migrationsFolder);
  console.log("[vercel-migrate] Drizzle migrations complete");

  await seedPlansIfMissing();
  console.log("[vercel-migrate] Plan seed check complete");

  await backfillEncryptedCredentials();
  console.log("[vercel-migrate] Credential backfill complete");
}
