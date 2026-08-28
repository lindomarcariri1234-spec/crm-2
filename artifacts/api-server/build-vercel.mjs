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
import { rm, mkdir, cp, readFile, readdir, access } from "node:fs/promises";

const require = createRequire(import.meta.url);
globalThis.require = require;

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "../..");
const outDir = path.resolve(repoRoot, "api");
const outFile = path.join(outDir, "index.mjs");

// Same externals list as build.mjs — see that file for the rationale behind
// each entry (native modules, fetch-patch ordering, ESM-incompatible
// transitive deps, etc.). Kept in sync manually; if build.mjs's list
// changes, mirror the change here.
const EXTERNAL = [
  "*.node",
  "sharp",
  "uploadthing",
  "@uploadthing/shared",
  "@uploadthing/mime-types",
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
  "@opentelemetry/*",
  "@google-cloud/*",
  "@google/*",
  "googleapis",
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
      "[build-vercel] FATAL: _uploadthingPatched marker not found in api/index.mjs.",
    );
  }
  if (!bundle.includes('"uploadthing/') && !bundle.includes('"uploadthing"')) {
    throw new Error(
      "[build-vercel] FATAL: no uploadthing require() found in api/index.mjs.",
    );
  }

  console.log("[build-vercel] ✓ fetch-patch order verified for api/index.mjs");
}

buildAll()
  .then(() => assertFetchPatchOrder())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
