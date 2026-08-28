import { access, cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(artifactDir, "../..");
const frontendDist = path.join(repoRoot, "artifacts/visitecrm/dist/public");
const vercelPublicDirs = [
  path.join(repoRoot, "public"),
  path.join(repoRoot, "artifacts/visitecrm/public"),
  path.join(repoRoot, "artifacts/api-server/public"),
];
const builtApiDir = path.join(repoRoot, "api");
const vercelApiDirs = [
  path.join(repoRoot, "artifacts/visitecrm/api"),
  path.join(repoRoot, "artifacts/api-server/api"),
];

function runPnpm(script, extraArgs = []) {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/api-server", script, ...extraArgs],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${script} exited with status ${result.status}`);
  }
}

function buildFrontend() {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/visitecrm", "build"],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Frontend build exited with status ${result.status}`);
  }
}

async function main() {
  buildFrontend();
  await access(path.join(frontendDist, "index.html"));

  for (const vercelPublicDir of vercelPublicDirs) {
    await rm(vercelPublicDir, { recursive: true, force: true });
    await cp(frontendDist, vercelPublicDir, { recursive: true });
    console.log(`[run-vercel-build] Frontend copied to ${vercelPublicDir}`);
  }

  runPnpm("migrate:vercel");
  runPnpm("build:vercel");

  await access(path.join(builtApiDir, "index.mjs"));
  for (const vercelApiDir of vercelApiDirs) {
    await rm(vercelApiDir, { recursive: true, force: true });
    await cp(builtApiDir, vercelApiDir, { recursive: true });
    console.log(`[run-vercel-build] API copied to ${vercelApiDir}`);
  }
}

main().catch((error) => {
  console.error("[run-vercel-build] FATAL:", error);
  process.exit(1);
});