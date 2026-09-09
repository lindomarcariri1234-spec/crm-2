import { appendFile, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KILOBYTE = 1000;

// These budgets are intentionally expressed in decimal kilobytes to match the
// units Vite prints in its production build report.
export const DEFAULT_FRONTEND_CHUNK_MAX_BYTES = 500 * KILOBYTE;
export const DEFAULT_EXCELJS_CHUNK_MAX_BYTES = 1000 * KILOBYTE;
export const EXCELJS_CHUNK_PATTERN = /^exceljs\.min-[A-Za-z0-9_-]+\.js$/;

function formatBytes(bytes) {
  return `${(bytes / KILOBYTE).toFixed(2)} kB (${bytes.toLocaleString("en-US")} bytes)`;
}

function formatPercentage(value) {
  return `${value.toFixed(2)}%`;
}

function bundleSummaryRow(label, asset, maxBytes) {
  const remainingBytes = maxBytes - asset.bytes;
  const usedPercentage = (asset.bytes / maxBytes) * 100;

  return (
    `| ${label} | \`${asset.name}\` | ${formatBytes(asset.bytes)} | ` +
    `${formatBytes(maxBytes)} | ${formatBytes(remainingBytes)} | ` +
    `${formatPercentage(usedPercentage)} |`
  );
}

export function formatFrontendBundleSummary({
  entrypoint,
  largestNormalChunk,
  exceljs,
  chunkMaxBytes = DEFAULT_FRONTEND_CHUNK_MAX_BYTES,
  exceljsMaxBytes = DEFAULT_EXCELJS_CHUNK_MAX_BYTES,
}) {
  return [
    "### Frontend bundle budget",
    "",
    "| Metric | Chunk | Size | Budget | Headroom | Used |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    bundleSummaryRow("Entrypoint", entrypoint, chunkMaxBytes),
    bundleSummaryRow("Largest normal chunk", largestNormalChunk, chunkMaxBytes),
    `${bundleSummaryRow("ExcelJS (lazy)", exceljs, exceljsMaxBytes)}\n`,
    "_Headroom is the remaining budget; ExcelJS is intentionally excluded from the initial page load._",
    "",
  ].join("\n");
}

export async function appendFrontendBundleSummary(summaryPath, summary) {
  await appendFile(summaryPath, `${summary}\n`, "utf8");
}

function assetReferencesFromHtml(html) {
  const references = new Set();
  const assetPattern = /["'](?:\/)?assets\/([^"'?#]+\.js)(?:[?#][^"']*)?["']/g;

  for (const match of html.matchAll(assetPattern)) {
    references.add(match[1]);
  }

  return references;
}

function getEntrypointFromHtml(html) {
  const moduleScript = html.match(
    /<script\b[^>]*\bsrc=["'](?:\/)?assets\/([^"'?#]+\.js)(?:[?#][^"']*)?["'][^>]*>/i,
  );
  return moduleScript?.[1] ?? null;
}

async function readJavaScriptAssets(publicDir) {
  const assetsDir = path.join(publicDir, "assets");
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const assets = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const assetPath = path.join(assetsDir, entry.name);
    const details = await stat(assetPath);
    assets.push({
      name: entry.name,
      path: assetPath,
      bytes: details.size,
    });
  }

  return assets;
}

function assertWithinBudget(asset, maxBytes, category) {
  if (asset.bytes <= maxBytes) return;

  throw new Error(
    `[frontend-bundle-size] FATAL: ${category} "${asset.name}" is ` +
      `${formatBytes(asset.bytes)}, above the ${formatBytes(maxBytes)} budget. ` +
      "Split the chunk or deliberately update the frontend bundle budget.",
  );
}

export async function inspectFrontendBundle(
  publicDir,
  {
    chunkMaxBytes = DEFAULT_FRONTEND_CHUNK_MAX_BYTES,
    exceljsMaxBytes = DEFAULT_EXCELJS_CHUNK_MAX_BYTES,
    logger = console,
    summaryPath = null,
  } = {},
) {
  const indexPath = path.join(publicDir, "index.html");
  const html = await readFile(indexPath, "utf8");
  const assets = await readJavaScriptAssets(publicDir);
  const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));
  const references = assetReferencesFromHtml(html);
  const entrypointName = getEntrypointFromHtml(html);

  if (!entrypointName) {
    throw new Error(
      `[frontend-bundle-size] FATAL: could not find the frontend module entrypoint in ${indexPath}.`,
    );
  }

  const entrypoint = assetsByName.get(entrypointName);
  if (!entrypoint) {
    throw new Error(
      `[frontend-bundle-size] FATAL: frontend entrypoint "${entrypointName}" ` +
        "is referenced by index.html but is missing from the assets directory.",
    );
  }

  const exceljsAssets = assets.filter((asset) =>
    EXCELJS_CHUNK_PATTERN.test(asset.name),
  );
  if (exceljsAssets.length !== 1) {
    throw new Error(
      `[frontend-bundle-size] FATAL: expected exactly one allowlisted ExcelJS ` +
        `chunk matching ${EXCELJS_CHUNK_PATTERN}, found ${exceljsAssets.length}.`,
    );
  }

  const [exceljs] = exceljsAssets;
  if (references.has(exceljs.name)) {
    throw new Error(
      `[frontend-bundle-size] FATAL: allowlisted ExcelJS chunk "${exceljs.name}" ` +
        "is referenced by index.html and would be loaded during the initial page load.",
    );
  }

  assertWithinBudget(entrypoint, chunkMaxBytes, "entrypoint");
  assertWithinBudget(exceljs, exceljsMaxBytes, "allowlisted ExcelJS chunk");

  const normalChunks = assets.filter((asset) => asset.name !== exceljs.name);
  for (const asset of normalChunks) {
    assertWithinBudget(asset, chunkMaxBytes, "normal frontend chunk");
  }

  const largestNormalChunk = normalChunks.reduce(
    (largest, asset) => (asset.bytes > largest.bytes ? asset : largest),
    normalChunks[0] ?? entrypoint,
  );
  logger.log(
    `[frontend-bundle-size] entrypoint ${entrypoint.name}: ` +
      `${formatBytes(entrypoint.bytes)} / ${formatBytes(chunkMaxBytes)} budget`,
  );
  logger.log(
    `[frontend-bundle-size] largest normal chunk ${largestNormalChunk.name}: ` +
      `${formatBytes(largestNormalChunk.bytes)} / ${formatBytes(chunkMaxBytes)} budget`,
  );
  logger.log(
    `[frontend-bundle-size] ExcelJS chunk ${exceljs.name}: ` +
      `${formatBytes(exceljs.bytes)} / ${formatBytes(exceljsMaxBytes)} allowlisted budget; ` +
      "confirmed lazy",
  );

  const result = {
    entrypoint,
    largestNormalChunk,
    exceljs,
    normalChunks,
    initialReferences: [...references],
  };

  if (summaryPath) {
    await appendFrontendBundleSummary(
      summaryPath,
      formatFrontendBundleSummary({
        ...result,
        chunkMaxBytes,
        exceljsMaxBytes,
      }),
    );
  }

  return result;
}

const defaultPublicDir = path.resolve("artifacts/visitecrm/dist/public");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectFrontendBundle(path.resolve(process.argv[2] ?? defaultPublicDir), {
    summaryPath: process.env.GITHUB_STEP_SUMMARY || null,
  }).catch((error) => {
    console.error(
      `[frontend-bundle-size] ERROR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}