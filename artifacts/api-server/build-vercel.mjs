// Bundles the Vercel serverless entry point (src/vercel-entry.ts) into a
// single tracked file at the repo root, at api/index.mjs — the path Vercel's
// zero-config Node.js runtime auto-detects as a serverless function. Keeping
// the generated entry point in git is intentional: Vercel discovers
// conventional functions before buildCommand creates new files.
//
// This mirrors build.mjs (the Replit long-running-process bundle) with two
// differences:
//   1. Different entry point / output location (vercel-entry.ts, not index.ts;
//      repo-root api/index.mjs, not dist/index.mjs) — the serverless entry
//      exports the Express app instead of calling app.listen().
//   2. No esbuild-plugin-pino / pino worker-thread transport bundling: the
//      logger (lib/logger.ts) only configures a `transport` (which spawns
//      pino-pretty in a worker thread) when NODE_ENV !== "production".
//      Vercel always runs with NODE_ENV=production, so pino writes JSON
//      directly to stdout with no worker threads — nothing extra to bundle
//      or list in `functions.includeFiles`.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm, mkdir, cp, readFile, readdir, access, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
globalThis.require = require;

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "../..");
const outDir = path.resolve(repoRoot, "api");
const outFile = path.join(outDir, "bundle.mjs");
const indexFile = path.join(outDir, "index.mjs");
const catchAllFile = path.join(outDir, "[...path].mjs");
const artifactOutDir = path.resolve(artifactDir, "api");

const FUNCTION_ENTRYPOINT = `let appPromise;

// Vercel traces dependencies from this small conventional function file, not
// from bundle.mjs added through includeFiles. Keep literal dynamic imports
// here so the corresponding external packages are copied into the function.
// This function is intentionally never executed: bundle.mjs must apply the
// UploadThing fetch patch before loading uploadthing itself.
function traceExternalDependenciesForVercel() {
  return Promise.all([
    import("googleapis"),
    import("http-proxy-middleware"),
    import("jspdf"),
    import("jspdf-autotable"),
    import("pdfkit"),
  ]);
}
void traceExternalDependenciesForVercel;

function getMissingPackage(error) {
  if (!error || typeof error !== "object") return undefined;
  const message = typeof error.message === "string" ? error.message : "";
  const match =
    message.match(/Cannot find package ['"]([^'"]+)['"]/) ??
    message.match(/Cannot find module ['"]([^'"]+)['"]/);
  const packageName = match?.[1];
  return packageName && /^@?[A-Za-z0-9_./-]+$/.test(packageName)
    ? packageName
    : undefined;
}

function restoreRewrittenApiPath(request) {
  const url = new URL(request.url || "/api", "http://vercel.internal");
  const path = url.searchParams.get("__vercel_api_path");
  if (path === null) return;
  url.searchParams.delete("__vercel_api_path");
  const search = url.searchParams.toString();
  request.url = \`/api/\${path}\${search ? \`?\${search}\` : ""}\`;
}

async function getApp() {
  appPromise ??= import("./bundle.mjs").then((module) => module.default);
  return appPromise;
}

export default async function handler(request, response) {
  try {
    const app = await getApp();
    restoreRewrittenApiPath(request);
    return app(request, response);
  } catch (error) {
    appPromise = undefined;
    console.error("[vercel] API bundle failed to initialize", error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        error: "SERVER_INIT_FAILED",
        code:
          error && typeof error === "object" && typeof error.code === "string"
            ? error.code
            : undefined,
        missingPackage: getMissingPackage(error),
      }),
    );
  }
}
`;

// Same externals list as build.mjs — see that file for the rationale behind
// each entry (native modules, fetch-patch ordering, ESM-incompatible
// transitive deps, etc.). Kept in sync manually; if build.mjs's list
// changes, mirror the change here.
const EXTERNAL = [
  "*.node",
  "sharp",
  "http-proxy-middleware",
  "jspdf",
  "jspdf-autotable",
  "html2canvas",
  "canvg",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "fsevents",
  "re2",
  "farmhash",
  "xxhash-addon",
  "bufferutil",
  "utf-8-validate",
  "ssh2",
  "cpu-features",
  "dtrace-provider",
  "isolated-vm",
  "lightningcss",
  "pg-native",
  "oracledb",
  "mongodb-client-encryption",
  "nodemailer",
  "handlebars",
  "knex",
  "typeorm",
  "protobufjs",
  "onnxruntime-node",
  "@tensorflow/*",
  "@prisma/client",
  "@mikro-orm/*",
  "@grpc/*",
  "@swc/*",
  "@aws-sdk/*",
  "@azure/*",
  "@google-cloud/*",
  "@google/*",
  "firebase-admin",
  "@parcel/watcher",
  "@sentry/profiling-node",
  "@tree-sitter/*",
  "aws-sdk",
  "classic-level",
  "dd-trace",
  "ffi-napi",
  "grpc",
  "hiredis",
  "kerberos",
  "leveldown",
  "miniflare",
  "mysql2",
  "newrelic",
  "odbc",
  "piscina",
  "realm",
  "ref-napi",
  "rocksdb",
  "sass-embedded",
  "sequelize",
  "serialport",
  "snappy",
  "tinypool",
  "usb",
  "workerd",
  "wrangler",
  "zeromq",
  "zeromq-prebuilt",
  "playwright",
  "puppeteer",
  "puppeteer-core",
  "electron",
  "pdfkit",
  "fontkit",
  "@swc/helpers",
];

async function buildAll() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/vercel-entry.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: outFile,
    logLevel: "info",
    external: EXTERNAL,
    // Do not emit the ~30 MB external source map into the committed
    // serverless artifact. Vercel only needs the bundle for function
    // discovery and regenerates it during every deployment build.
    sourcemap: false,
    // Make sure CJS-only packages bundled in continue to work in ESM output,
    // and stripe-replit-sync's __dirname-relative migrations lookup resolves
    // to this output directory (migrations copied alongside it below).
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await Promise.all([
    writeFile(indexFile, FUNCTION_ENTRYPOINT, "utf8"),
    writeFile(catchAllFile, FUNCTION_ENTRYPOINT, "utf8"),
  ]);

  // stripe-replit-sync reads its SQL migrations at runtime via a
  // __dirname-relative path. Copy them next to the bundle (same rationale
  // as build.mjs).
  const stripeSyncEntry = require.resolve("stripe-replit-sync");
  const stripeSyncMigrations = path.join(path.dirname(stripeSyncEntry), "migrations");
  try {
    await access(stripeSyncMigrations);
    const migrationFiles = (await readdir(stripeSyncMigrations)).filter((f) => f.endsWith(".sql"));
    if (migrationFiles.length > 0) {
      await cp(stripeSyncMigrations, path.join(outDir, "migrations"), { recursive: true });
      console.log(`[build-vercel] Copied ${migrationFiles.length} stripe-replit-sync migration(s) to api/migrations`);
    }
  } catch {
    console.log("[build-vercel] stripe-replit-sync migrations not found — skipping (Stripe sync may be unused).");
  }

  // Keep the pre-built function entrypoint at both the repository root and the
  // legacy artifact root. The Vercel project should use the repository root,
  // but the mirror keeps function discovery safe while that setting migrates.
  await rm(artifactOutDir, { recursive: true, force: true });
  await cp(outDir, artifactOutDir, { recursive: true });
  console.log(`[build-vercel] Mirrored serverless function to ${artifactOutDir}`);
}

async function assertFetchPatchOrder() {
  const sourcePath = path.resolve(artifactDir, "src/vercel-entry.ts");
  const source = await readFile(sourcePath, "utf8");

  if (!source.includes('from "./lib/fetch-patch"')) {
    throw new Error(
      "[build-vercel] FATAL: fetch-patch.ts is not statically imported in src/vercel-entry.ts.",
    );
  }
  if (/^\s*import\s+app\s+from\s+["']\.\/app["']/m.test(source)) {
    throw new Error(
      "[build-vercel] FATAL: `import app from './app'` is a static import in src/vercel-entry.ts. " +
      "Change to `const { default: app } = await import('./app')`.",
    );
  }
  if (!source.includes('import("./app")')) {
    throw new Error(
      "[build-vercel] FATAL: dynamic `import('./app')` not found in src/vercel-entry.ts.",
    );
  }

  const bundle = await readFile(outFile, "utf8");
  if (!bundle.includes("_uploadthingPatched")) {
    throw new Error(
      "[build-vercel] FATAL: _uploadthingPatched marker not found in api/bundle.mjs.",
    );
  }
  if (!bundle.includes("UploadThingError")) {
    throw new Error(
      "[build-vercel] FATAL: bundled UploadThing implementation not found in api/bundle.mjs.",
    );
  }

  console.log("[build-vercel] ✓ fetch-patch order verified for api/bundle.mjs");
}

buildAll()
  .then(() => assertFetchPatchOrder())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
