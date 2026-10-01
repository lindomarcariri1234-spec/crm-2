import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBundleFresh,
  getBundleSourceFingerprint,
} from "./bundle-integrity.mjs";
import { assertBundleSize } from "./vercel-bundle-size.mjs";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(artifactDir, "../..");
const bundlePaths = [
  [path.join(repoRoot, "api/bundle.mjs"), "api/bundle.mjs"],
  [
    path.join(repoRoot, "artifacts/api-server/api/bundle.mjs"),
    "artifacts/api-server/api/bundle.mjs",
  ],
];

async function assertVercelApiRewrites() {
  const configPath = path.join(repoRoot, "vercel.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const rewrites = config.rewrites;
  if (!Array.isArray(rewrites)) {
    throw new Error("vercel.json must define a rewrites array");
  }

  const indexOfSource = (source) =>
    rewrites.findIndex((rewrite) => rewrite.source === source);
  const rootApiIndex = indexOfSource("/api");
  const apiPathIndex = indexOfSource("/api/:path*");
  const spaFallbackIndex = indexOfSource("/:path*");
  const rootApiRewrite = rewrites[rootApiIndex];
  const apiPathRewrite = rewrites[apiPathIndex];
  const expectedRootDestination = apiPathRewrite?.destination
    ?.replace(/\/:path\*$/, "");

  if (
    rootApiIndex < 0 ||
    apiPathIndex < 0 ||
    rootApiIndex >= apiPathIndex ||
    spaFallbackIndex < apiPathIndex ||
    rootApiRewrite?.destination !== expectedRootDestination
  ) {
    throw new Error(
      "Vercel must rewrite exact /api to the same backend before /api/:path* and the SPA fallback",
    );
  }

  const expectedStorefrontRewrites = [
    ["/loja/:slug", "/api/storefront?store_slug=:slug"],
    [
      "/loja/:slug/:rest*",
      "/api/storefront?store_slug=:slug&store_path=:rest*",
    ],
  ];
  for (const [source, destination] of expectedStorefrontRewrites) {
    const index = indexOfSource(source);
    if (index < 0 || index >= rootApiIndex || rewrites[index]?.destination !== destination) {
      throw new Error(
        `Vercel storefront rewrite ${source} must remain ahead of the API rewrites`,
      );
    }
  }
  console.log("[verify-vercel-bundle] ✓ /api and /api/* rewrites target the backend; /loja rewrites are preserved");
}

async function main() {
  await assertVercelApiRewrites();
  const fingerprint = await getBundleSourceFingerprint(repoRoot);
  for (const [bundlePath, label] of bundlePaths) {
    await assertBundleFresh(bundlePath, label, fingerprint);
    console.log(`[verify-vercel-bundle] ✓ ${label} matches current sources`);
    await assertBundleSize(bundlePath, label);
  }
}

main().catch((error) => {
  console.error("[verify-vercel-bundle] FATAL:", error);
  process.exit(1);
});
