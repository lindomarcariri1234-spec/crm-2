// Bundles src/scripts/vercel-migrate.ts (which pulls in @workspace/db,
// lib/seed-plans.ts and lib/credential-backfill.ts — all TypeScript) into a
// throwaway temp file and runs it. Invoked from vercel.json's buildCommand,
// AFTER `pnpm --filter @workspace/db exec tsc --build` and BEFORE the
// frontend/API bundling steps.
//
// The output deliberately does NOT live under artifacts/api-server/../../api/
// — anything placed in the repo-root `api/` directory is auto-detected by
// Vercel as a public serverless function. A migration script must never be
// reachable over HTTP, so it is bundled to the OS temp dir instead.
import { build as esbuild } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "vercel-migrate-"));
  const outFile = path.join(tempDir, "migrate.mjs");

  try {
    await esbuild({
      entryPoints: [path.resolve(artifactDir, "src/scripts/vercel-migrate.ts")],
      platform: "node",
      bundle: true,
      format: "esm",
      outfile: outFile,
      logLevel: "info",
      // Same native/unbundleable externals as the app build — the migration
      // script transitively imports lib/credential-backfill.ts and
      // lib/seed-plans.ts, which do not touch these, but keeping the list
      // identical avoids silently bundling something that expects to load
      // from node_modules at runtime.
      external: ["*.node", "pg-native"],
    });

    console.log(`[run-vercel-migrate] Bundled migration script, executing ${outFile}`);
    const { runVercelMigration } = await import(outFile);
    await runVercelMigration();
    console.log("[run-vercel-migrate] Migration complete");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[run-vercel-migrate] FATAL:", err);
    process.exit(1);
  });
