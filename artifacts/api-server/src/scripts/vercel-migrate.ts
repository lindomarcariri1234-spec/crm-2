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

// The runner bundles this script to an OS temp directory so Vercel cannot
// mistake it for an HTTP function. Its original source location is therefore
// unavailable at runtime; the runner passes the actual repository root in an
// environment variable instead.
const repoRoot = process.env["VERCEL_MIGRATION_REPO_ROOT"];
if (!repoRoot) {
  throw new Error(
    "[vercel-migrate] VERCEL_MIGRATION_REPO_ROOT is not configured by the migration runner.",
  );
}
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

  // These modules initialize the PostgreSQL connection at import time. Load
  // them only after configuration has been checked so a missing env variable
  // produces the actionable errors above instead of a lower-level driver error.
  const [
    { runMigrations },
    { seedPlansIfMissing },
    { backfillEncryptedCredentials },
  ] = await Promise.all([
    import("@workspace/db"),
    import("../lib/seed-plans"),
    import("../lib/credential-backfill"),
  ]);

  console.log(`[vercel-migrate] Applying migrations from ${migrationsFolder}`);
  await runMigrations(migrationsFolder);
  console.log("[vercel-migrate] Drizzle migrations complete");

  await seedPlansIfMissing();
  console.log("[vercel-migrate] Plan seed check complete");

  await backfillEncryptedCredentials();
  console.log("[vercel-migrate] Credential backfill complete");
}
