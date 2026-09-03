import { readFile } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const MEBIBYTE = 1024 * 1024;

// Keep the default ceiling below the provider's transport/function limits.
// Both values can be overridden in the Vercel build environment when the
// operational budget changes, without changing the build implementation.
export const DEFAULT_BUNDLE_WARN_BYTES = 45 * MEBIBYTE;
export const DEFAULT_BUNDLE_MAX_BYTES = 50 * MEBIBYTE;

const BYTE_UNITS = new Map([
  ["b", 1],
  ["kb", 1000],
  ["kib", 1024],
  ["mb", 1000 ** 2],
  ["mib", MEBIBYTE],
  ["gb", 1000 ** 3],
  ["gib", 1024 ** 3],
]);

function parseByteLimit(value, variableName, fallback) {
  if (value === undefined || value === "") return fallback;

  const match = String(value)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/);
  if (!match) {
    throw new Error(
      `[vercel-bundle-size] FATAL: ${variableName} must be a positive byte value ` +
        "(for example, 47185920, 45MiB, or 50MB).",
    );
  }

  const amount = Number(match[1]);
  const multiplier = BYTE_UNITS.get(match[2] ?? "b");
  const bytes = amount * multiplier;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(
      `[vercel-bundle-size] FATAL: ${variableName} must be a positive safe integer.`,
    );
  }
  return bytes;
}

export function getBundleSizeLimits(env = process.env) {
  const maxBytes = parseByteLimit(
    env.VERCEL_BUNDLE_MAX_BYTES,
    "VERCEL_BUNDLE_MAX_BYTES",
    DEFAULT_BUNDLE_MAX_BYTES,
  );
  const defaultWarningBytes =
    env.VERCEL_BUNDLE_WARN_BYTES === undefined ||
    env.VERCEL_BUNDLE_WARN_BYTES === ""
      ? Math.min(
          DEFAULT_BUNDLE_WARN_BYTES,
          Math.max(1, Math.floor(maxBytes * 0.9)),
        )
      : DEFAULT_BUNDLE_WARN_BYTES;
  const warningBytes = parseByteLimit(
    env.VERCEL_BUNDLE_WARN_BYTES,
    "VERCEL_BUNDLE_WARN_BYTES",
    defaultWarningBytes,
  );

  if (warningBytes >= maxBytes) {
    throw new Error(
      "[vercel-bundle-size] FATAL: VERCEL_BUNDLE_WARN_BYTES must be lower " +
        "than VERCEL_BUNDLE_MAX_BYTES.",
    );
  }

  return { warningBytes, maxBytes };
}

export function formatBytes(bytes) {
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB (${bytes.toLocaleString("en-US")} bytes)`;
}

export async function measureBundle(bundlePath, label) {
  const contents = await readFile(bundlePath);
  const compressed = await gzipAsync(contents, { level: 9 });
  return {
    bundlePath,
    label,
    bytes: contents.byteLength,
    gzipBytes: compressed.byteLength,
  };
}

export function reportBundleSize(report, limits, logger = console) {
  logger.log(
    `[vercel-bundle-size] ${report.label}: ` +
      `${formatBytes(report.bytes)} raw; ` +
      `${formatBytes(report.gzipBytes)} gzip; ` +
      `warning at ${formatBytes(limits.warningBytes)}, ` +
      `maximum ${formatBytes(limits.maxBytes)}`,
  );

  if (report.bytes >= limits.maxBytes) {
    throw new Error(
      `[vercel-bundle-size] FATAL: ${report.label} is ${formatBytes(report.bytes)}, ` +
        `at or above the configured maximum of ${formatBytes(limits.maxBytes)}. ` +
        "Reduce the serverless bundle or raise VERCEL_BUNDLE_MAX_BYTES deliberately.",
    );
  }

  if (report.bytes >= limits.warningBytes) {
    logger.warn(
      `[vercel-bundle-size] WARNING: ${report.label} is within the configured ` +
        `maximum (${formatBytes(report.bytes)} of ${formatBytes(limits.maxBytes)}).`,
    );
  }
}

export async function assertBundleSize(
  bundlePath,
  label,
  limits = getBundleSizeLimits(),
  logger = console,
) {
  const report = await measureBundle(bundlePath, label);
  reportBundleSize(report, limits, logger);
  return report;
}