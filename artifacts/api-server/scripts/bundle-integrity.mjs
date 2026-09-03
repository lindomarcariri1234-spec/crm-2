import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// These are the workspace sources that can be imported by the API entrypoint.
// Keeping the list explicit avoids making test-only changes invalidate a
// production bundle while still covering every package that is bundled.
const SOURCE_ROOTS = [
  "artifacts/api-server/src",
  "lib/api-zod/src",
  "lib/db/src",
  "lib/email/src",
  "lib/integrations-openai-ai-server/src",
  "lib/permissions/src",
  "lib/shared/src",
];

const BUILD_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "vercel.json",
  "artifacts/api-server/package.json",
  "artifacts/api-server/tsconfig.json",
  "artifacts/api-server/build.mjs",
  "artifacts/api-server/build-vercel.mjs",
  "artifacts/api-server/vercel.json",
  "artifacts/api-server/scripts/bundle-integrity.mjs",
];

async function collectFiles(rootDir, relativeDir, files) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.posix.join(
      relativeDir.replaceAll(path.sep, "/"),
      entry.name,
    );
    if (entry.isDirectory()) {
      await collectFiles(rootDir, relativePath, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

export async function getBundleSourceFingerprint(repoRoot) {
  const files = [...BUILD_INPUTS];
  for (const sourceRoot of SOURCE_ROOTS) {
    await collectFiles(repoRoot, sourceRoot, files);
  }

  files.sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(repoRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function getBundleIntegrityBanner(fingerprint) {
  return `/* VISITECRM_BUNDLE_SOURCE_FINGERPRINT:${fingerprint} */`;
}

export async function assertBundleFresh(
  bundlePath,
  label,
  expectedFingerprint,
) {
  const bundle = await readFile(bundlePath, "utf8");
  const match = bundle.match(
    /VISITECRM_BUNDLE_SOURCE_FINGERPRINT:([a-f0-9]{64})/,
  );
  if (!match) {
    throw new Error(
      `[bundle-integrity] FATAL: ${label} has no source fingerprint. ` +
        "Regenerate the API bundle before publishing.",
    );
  }
  if (match[1] !== expectedFingerprint) {
    throw new Error(
      `[bundle-integrity] FATAL: ${label} is stale. ` +
        `Expected source fingerprint ${expectedFingerprint}, found ${match[1]}. ` +
        "Regenerate the API bundle before publishing.",
    );
  }
}
