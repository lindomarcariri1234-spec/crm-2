import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, readFile, readdir, access } from "node:fs/promises";
import {
  assertBundleFresh,
  getBundleIntegrityBanner,
  getBundleSourceFingerprint,
} from "./scripts/bundle-integrity.mjs";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
const require = createRequire(import.meta.url);
globalThis.require = require;

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  const sourceFingerprint = await getBundleSourceFingerprint(
    path.resolve(artifactDir, "../.."),
  );
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    //
    // Bundle size note (~16-17 MB bundled, esbuild ⚠️):
    // The remaining size is dominated by intentionally-kept dependencies:
    //   - @react-email/* + react-dom (~2.5 MB): React server-side email rendering; cannot be
    //     externalized without breaking email template compilation at runtime.
    //   - jspdf + jspdf-autotable (~700 KB bundled): externalized below so they load from
    //     node_modules at runtime, removing html2canvas/canvg transitive browser deps (~700 KB).
    //   - prettier (~800 KB, 2 versions): used at runtime by @react-email/tailwind for CSS
    //     processing during email rendering; cannot be externalized.
    //   - luxon (~260 KB): date/time library used extensively across the codebase.
    //   - zod (~100 KB): runtime validation.
    // Replit deployments include node_modules, so externalizing node-compatible libs is safe.
    external: [
      "*.node",
      "sharp",
      // uploadthing must be external so that our globalThis.fetch patch (applied
      // at bundle init time) runs BEFORE uploadthing loads and captures fetch by
      // value.  If bundled, uploadthing initialises inside the esbuild bundle
      // before our patch code runs — making any fetch/undici patch ineffective.
      "uploadthing",
      "@uploadthing/shared",
      "@uploadthing/mime-types",
      // http-proxy-middleware@3 has transitive deps (entities, cheerio) that use
      // explicit .js ESM imports in ways esbuild cannot resolve — externalize
      // the whole package and load it from node_modules at runtime via symlink.
      "http-proxy-middleware",
      // PDF generation — externalized to avoid bundling html2canvas/canvg (browser deps of jspdf)
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
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `${getBundleIntegrityBanner(sourceFingerprint)}
import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // stripe-replit-sync ships SQL migrations it loads at runtime via a __dirname-relative
  // path ("./migrations"). esbuild bundles the package into a single file and the banner
  // above sets __dirname to the bundle dir, so at runtime runMigrations() looks for
  // <dist>/migrations. Copy the package's migrations folder there so they can be applied.
  const stripeSyncEntry = require.resolve("stripe-replit-sync");
  const stripeSyncMigrations = path.join(
    path.dirname(stripeSyncEntry),
    "migrations",
  );

  // Preflight: verify the migrations folder exists and contains at least one .sql file.
  // If the package layout ever changes (folder moved/renamed), fail loudly at build time
  // instead of silently producing an empty bundle dir and missing stripe.* tables in prod.
  try {
    await access(stripeSyncMigrations);
  } catch {
    throw new Error(
      `[build] stripe-replit-sync migrations folder not found at: ${stripeSyncMigrations}\n` +
        `Ensure stripe-replit-sync is installed and its package layout hasn't changed.`,
    );
  }
  const migrationFiles = (await readdir(stripeSyncMigrations)).filter((f) =>
    f.endsWith(".sql"),
  );
  if (migrationFiles.length === 0) {
    throw new Error(
      `[build] stripe-replit-sync migrations folder exists but contains no .sql files: ${stripeSyncMigrations}\n` +
        `The package may have changed its layout. Check the stripe-replit-sync package contents.`,
    );
  }

  await cp(stripeSyncMigrations, path.join(distDir, "migrations"), {
    recursive: true,
  });
  console.log(
    `[build] Copied ${migrationFiles.length} stripe-replit-sync migration(s) to dist/migrations`,
  );
  await assertBundleFresh(
    path.join(distDir, "index.mjs"),
    "artifacts/api-server/dist/index.mjs",
    sourceFingerprint,
  );
}

async function assertFetchPatchOrder() {
  // ── Source checks ──
  // Text-position comparison in the bundle cannot distinguish runtime evaluation
  // order when dynamic imports are involved (esbuild may emit the lazy chunk
  // before the eager module body in the output file even though it loads later).
  // We therefore check the structural contract in src/index.ts directly.
  const sourcePath = path.resolve(artifactDir, "src/index.ts");
  const source = await readFile(sourcePath, "utf8");

  // 1. fetch-patch must be a STATIC import — static imports are evaluated before
  //    any module body code runs, guaranteeing the patch is in place first.
  if (!source.includes('from "./lib/fetch-patch"')) {
    throw new Error(
      "[build] FATAL: fetch-patch.ts is not statically imported in src/index.ts. " +
        "Add `import { FETCH_PATCH_APPLIED } from './lib/fetch-patch'` as a static " +
        "import so the patch runs before any uploadthing module loads.",
    );
  }

  // 2. app must NOT be a static import — app.ts transitively loads uploadthing,
  //    which captures globalThis.fetch by value during module graph evaluation.
  if (/^\s*import\s+app\s+from\s+["']\.\/app["']/m.test(source)) {
    throw new Error(
      "[build] FATAL: `import app from './app'` is a static import in src/index.ts. " +
        "app.ts transitively loads uploadthing — change to `await import('./app')` so " +
        "uploadthing can only load AFTER fetch-patch has already patched globalThis.fetch.",
    );
  }

  // 3. app must be dynamically imported — this is what makes the ordering structural
  //    rather than convention-based.
  if (!source.includes('import("./app")')) {
    throw new Error(
      "[build] FATAL: dynamic `import('./app')` not found in src/index.ts. " +
        "app must be loaded via `await import('./app')` so uploadthing loads after the " +
        "globalThis.fetch patch and the _uploadthingPatched assertion have run.",
    );
  }

  // ── Bundle checks ──
  const bundlePath = path.resolve(artifactDir, "dist/index.mjs");
  const bundle = await readFile(bundlePath, "utf8");

  // 4. The _uploadthingPatched marker must exist in the bundle — confirms
  //    fetch-patch.ts was compiled and included, not accidentally dropped.
  if (!bundle.includes("_uploadthingPatched")) {
    throw new Error(
      "[build] FATAL: _uploadthingPatched marker not found in dist/index.mjs. " +
        "fetch-patch.ts may have been excluded from the bundle. " +
        "UploadThing CDN uploads will fail with 'Invalid signature'.",
    );
  }

  // 5. At least one uploadthing external require must exist in the bundle.
  //    If uploadthing were bundled inline (removed from externals), its
  //    FetchHttpClient would be initialized during module evaluation —
  //    before the dynamic import defers it — breaking the ordering guarantee.
  if (!bundle.includes('"uploadthing/')) {
    throw new Error(
      "[build] FATAL: no uploadthing require() found in dist/index.mjs. " +
        "uploadthing must stay in the externals list in build.mjs so it is loaded " +
        "via Node require() at runtime (inside the dynamic app import), not bundled " +
        "inline during module graph evaluation.",
    );
  }

  console.log(
    "[build] ✓ fetch-patch order verified: static fetch-patch import + dynamic app import + uploadthing external",
  );
}

buildAll()
  .then(() => assertFetchPatchOrder())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
