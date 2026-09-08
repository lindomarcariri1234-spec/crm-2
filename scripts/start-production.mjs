import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { assertPublicationVersion } from "./publication-marker.mjs";
import { verifyPublication } from "./verify-publication.mjs";

const port = Number(process.env["PORT"] ?? "8080");
const localHealthUrl = `http://127.0.0.1:${port}/api/healthz`;
const configuredStartupTimeoutMs = Number(
  process.env["PUBLICATION_STARTUP_TIMEOUT_MS"],
);
const startupTimeoutMs =
  Number.isFinite(configuredStartupTimeoutMs) && configuredStartupTimeoutMs > 0
    ? configuredStartupTimeoutMs
    : 120_000;
const localHealthTimeoutMs = 2_000;
const storefrontIndexPath = path.resolve(
  process.env["PUBLICATION_INDEX_PATH"] ??
    "artifacts/visitecrm/dist/public/index.html",
);
const publicationVersionPath = path.resolve(
  process.env["PUBLICATION_VERSION_PATH"] ??
    "artifacts/visitecrm/dist/public/.publication-version",
);
const apiEntrypoint = path.resolve(
  process.env["PUBLICATION_API_ENTRYPOINT"] ??
    "artifacts/api-server/dist/index.mjs",
);
let shuttingDown = false;
let apiProcess;
let apiExit;
let apiExited = Promise.resolve();

function runProductionOneShotRepair() {
  const repair = process.env["VISITECRM_ONE_SHOT_REPAIR"]?.trim();
  if (!repair) return;
  if (repair !== "referral-cancellation") {
    throw new Error(
      "[publication-smoke] VISITECRM_ONE_SHOT_REPAIR must be referral-cancellation when set.",
    );
  }
  if (process.env["NODE_ENV"] !== "production") {
    throw new Error(
      "[publication-smoke] One-shot repairs are allowed only in the production runtime.",
    );
  }

  const apply = process.env["VISITECRM_ONE_SHOT_REPAIR_APPLY"];
  if (apply !== "true" && apply !== "false") {
    throw new Error(
      "[publication-smoke] VISITECRM_ONE_SHOT_REPAIR_APPLY must be explicitly true or false.",
    );
  }

  const required = [
    "VISITECRM_ONE_SHOT_REPAIR_TENANT_ID",
    "VISITECRM_ONE_SHOT_REPAIR_REFERRAL_ID",
    "VISITECRM_ONE_SHOT_REPAIR_RESERVATION_ID",
    "VISITECRM_ONE_SHOT_REPAIR_REASON",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `[publication-smoke] Referral cancellation repair is missing: ${missing.join(", ")}.`,
    );
  }

  const args = [
    "--tenant-id=" + process.env["VISITECRM_ONE_SHOT_REPAIR_TENANT_ID"].trim(),
    "--referral-id=" + process.env["VISITECRM_ONE_SHOT_REPAIR_REFERRAL_ID"].trim(),
    "--reservation-id=" + process.env["VISITECRM_ONE_SHOT_REPAIR_RESERVATION_ID"].trim(),
    "--reason=" + process.env["VISITECRM_ONE_SHOT_REPAIR_REASON"].trim(),
  ];
  if (apply === "true") args.push("--apply");

  console.log(
    `[publication-smoke] Running production referral cancellation ${apply === "true" ? "apply" : "dry-run"} ` +
      "inside the same runtime as the published API.",
  );
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@workspace/scripts",
      "run",
      "repair:referral-cancellation",
      "--",
      ...args,
    ],
    {
      cwd: path.resolve("."),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `[publication-smoke] Production referral repair exited with status ${result.status}.`,
    );
  }
}

async function stopApi(signal = "SIGTERM") {
  if (!apiProcess) return;
  if (apiProcess.exitCode !== null || apiProcess.signalCode !== null) return;
  apiProcess.kill(signal);
  await Promise.race([apiExited, delay(10_000)]);
  if (apiProcess.exitCode === null && apiProcess.signalCode === null) {
    apiProcess.kill("SIGKILL");
  }
}

async function waitForLocalHealth() {
  const deadline = Date.now() + startupTimeoutMs;
  let lastFailure = "no response";

  while (Date.now() < deadline) {
    if (apiExit) {
      throw new Error(
        `API process exited before readiness (code=${String(apiExit.code)}, signal=${String(apiExit.signal)})`,
      );
    }

    try {
      const response = await fetch(localHealthUrl, {
        signal: AbortSignal.timeout(localHealthTimeoutMs),
        headers: { "User-Agent": "VisiteCRM-publication-smoke-test" },
      });
      const body = await response.text();
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = null;
      }

      if (response.status === 200 && payload?.status === "ok") {
        console.log(
          `[publication-smoke] Local API health is ready at ${localHealthUrl}`,
        );
        return;
      }
      lastFailure = `HTTP ${response.status}, status=${String(payload?.status ?? "invalid")}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    await delay(1_000);
  }

  throw new Error(
    `API did not become healthy within ${startupTimeoutMs}ms (${lastFailure})`,
  );
}

export async function getLocalPublicationVersion(
  indexPath = storefrontIndexPath,
  expectedVersion,
) {
  let html;
  try {
    html = await readFile(indexPath, "utf8");
  } catch (error) {
    throw new Error(
      `Published storefront index is unavailable at ${indexPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return assertPublicationVersion(
    html,
    `Published storefront index at ${indexPath}`,
    expectedVersion,
  );
}

export async function getBuiltPublicationVersion(
  versionPath = publicationVersionPath,
) {
  let version;
  try {
    version = (await readFile(versionPath, "utf8")).trim();
  } catch (error) {
    throw new Error(
      `Built storefront publication version is unavailable at ${versionPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!version) {
    throw new Error(
      `Built storefront publication version is empty at ${versionPath}.`,
    );
  }

  return version;
}

async function run() {
  try {
    const configuredExpectedVersion =
      process.env["PUBLICATION_EXPECTED_VERSION"]?.trim() || undefined;
    const expectedVersion =
      configuredExpectedVersion ??
      (await getBuiltPublicationVersion(publicationVersionPath));
    await getLocalPublicationVersion(storefrontIndexPath, expectedVersion);
    runProductionOneShotRepair();
    apiProcess = spawn(
      process.execPath,
      ["--enable-source-maps", apiEntrypoint],
      {
        env: {
          ...process.env,
          PUBLICATION_EXPECTED_VERSION: expectedVersion,
        },
        stdio: "inherit",
      },
    );
    apiExited = new Promise((resolve) => {
      apiProcess.once("exit", (code, signal) => {
        apiExit = { code, signal };
        resolve(apiExit);
      });
    });

    await waitForLocalHealth();
    console.log(
      `[publication-smoke] Local publication version is "${expectedVersion}"`,
    );
    const canonicalUrl =
      process.env["PUBLICATION_CANONICAL_URL"] ??
      process.env["PUBLICATION_SMOKE_URL"];
    const results = await verifyPublication({ expectedVersion, canonicalUrl });
    let failed = false;
    for (const result of results) {
      const prefix = result.ok ? "PASS" : "FAIL";
      console.log(
        `[publication-smoke] ${prefix} ${result.name}: ${result.message}`,
      );
      failed ||= !result.ok;
    }
    if (failed) {
      throw new Error(
        "Publication smoke test failed. The storefront and API must pass before this deployment is considered ready.",
      );
    }
    console.log("[publication-smoke] Publication confirmed successfully.");
  } catch (error) {
    console.error(
      `[publication-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    await stopApi();
    process.exitCode = 1;
    return;
  }

  await apiExited;
  if (!shuttingDown && (apiExit?.code ?? 1) !== 0) {
    process.exitCode = 1;
  }
}

function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await stopApi(signal);
      process.exit(0);
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  installSignalHandlers();
  await run();
}
