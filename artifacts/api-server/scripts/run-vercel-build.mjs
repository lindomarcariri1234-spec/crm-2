import { access, cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPublicationArtifact } from "../../../scripts/publication-marker.mjs";

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

export async function verifyFrontendPublication(
  publicDir,
  sourceDescription = "Vercel storefront",
) {
  return assertPublicationArtifact({
    indexPath: path.join(publicDir, "index.html"),
    versionPath: path.join(publicDir, ".publication-version"),
    sourceDescription,
  });
}

function runOneShotRepairIfRequested() {
  const repair = process.env["VISITECRM_ONE_SHOT_REPAIR"];
  if (!repair) return;
  if (process.env["VERCEL_ENV"] !== "production") {
    throw new Error(
      "[run-vercel-build] One-shot repairs are allowed only in the Vercel Production environment.",
    );
  }
  if (repair !== "orphan-reservation") {
    throw new Error(
      "[run-vercel-build] VISITECRM_ONE_SHOT_REPAIR must be orphan-reservation when set.",
    );
  }

  const apply = process.env["VISITECRM_ONE_SHOT_REPAIR_APPLY"];
  if (apply !== "true" && apply !== "false") {
    throw new Error(
      "[run-vercel-build] VISITECRM_ONE_SHOT_REPAIR_APPLY must be explicitly true or false.",
    );
  }

  const tenantId = process.env["VISITECRM_ONE_SHOT_REPAIR_TENANT_ID"]?.trim();
  const reservationId = process.env["VISITECRM_ONE_SHOT_REPAIR_RESERVATION_ID"]?.trim();
  const reservationNumber = process.env["VISITECRM_ONE_SHOT_REPAIR_RESERVATION_NUMBER"]?.trim();
  if (!tenantId) {
    throw new Error(
      "[run-vercel-build] VISITECRM_ONE_SHOT_REPAIR_TENANT_ID is required.",
    );
  }
  if ((reservationId && reservationNumber) || (!reservationId && !reservationNumber)) {
    throw new Error(
      "[run-vercel-build] Set exactly one of VISITECRM_ONE_SHOT_REPAIR_RESERVATION_ID " +
        "or VISITECRM_ONE_SHOT_REPAIR_RESERVATION_NUMBER.",
    );
  }

  const repairArgs = [
    "--tenant-id=" + tenantId,
    reservationId ? "--reservation-id=" + reservationId : "--reservation-number=" + reservationNumber,
  ];
  if (apply === "true") repairArgs.push("--apply");

  console.log(
    `[run-vercel-build] Running explicitly requested ${apply === "true" ? "apply" : "dry-run"} ` +
      "one-shot repair; database credentials remain managed by Vercel.",
  );
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "repair:orphan-reservation", "--", ...repairArgs],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`One-shot repair exited with status ${result.status}`);
  }
}

async function main() {
  buildFrontend();
  await access(path.join(frontendDist, "index.html"));
  const frontendVersion = await verifyFrontendPublication(
    frontendDist,
    "Built Vercel storefront",
  );
  console.log(
    `[run-vercel-build] Frontend publication version "${frontendVersion}" confirmed before copying.`,
  );

  for (const vercelPublicDir of vercelPublicDirs) {
    await rm(vercelPublicDir, { recursive: true, force: true });
    await cp(frontendDist, vercelPublicDir, { recursive: true });
    await verifyFrontendPublication(
      vercelPublicDir,
      "Copied Vercel storefront",
    );
    console.log(`[run-vercel-build] Frontend copied to ${vercelPublicDir}`);
  }

  runPnpm("migrate:vercel");
  runPnpm("build:vercel");
  runOneShotRepairIfRequested();

  await access(path.join(builtApiDir, "index.mjs"));
  for (const vercelApiDir of vercelApiDirs) {
    await rm(vercelApiDir, { recursive: true, force: true });
    await cp(builtApiDir, vercelApiDir, { recursive: true });
    console.log(`[run-vercel-build] API copied to ${vercelApiDir}`);
  }

  runPnpm("verify:vercel");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("[run-vercel-build] FATAL:", error);
    process.exit(1);
  });
}
