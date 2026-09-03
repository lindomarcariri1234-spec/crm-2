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

async function main() {
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
