import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_EXCELJS_CHUNK_MAX_BYTES,
  DEFAULT_FRONTEND_CHUNK_MAX_BYTES,
  formatFrontendBundleSummary,
  inspectFrontendBundle,
} from "./frontend-bundle-size.mjs";

async function makeBundle({
  entrypointBytes = 100,
  normalChunkBytes = 200,
  exceljsBytes = 900,
  preloadExceljs = false,
} = {}) {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "visitecrm-bundle-"));
  const assetsDir = path.join(publicDir, "assets");
  await mkdir(assetsDir);

  await writeFile(
    path.join(publicDir, "index.html"),
    [
      `<script type="module" crossorigin src="/assets/index.js"></script>`,
      `<link rel="modulepreload" crossorigin href="/assets/vendor.js">`,
      preloadExceljs
        ? `<link rel="modulepreload" crossorigin href="/assets/exceljs.min-test.js">`
        : "",
    ].join("\n"),
  );
  await writeFile(path.join(assetsDir, "index.js"), "x".repeat(entrypointBytes));
  await writeFile(path.join(assetsDir, "vendor.js"), "x".repeat(normalChunkBytes));
  await writeFile(
    path.join(assetsDir, "exceljs.min-test.js"),
    "x".repeat(exceljsBytes),
  );

  return publicDir;
}

test("accepts normal chunks and keeps the ExcelJS chunk outside the initial load", async () => {
  const publicDir = await makeBundle();
  try {
    const result = await inspectFrontendBundle(publicDir, {
      logger: { log() {} },
    });

    assert.equal(result.entrypoint.name, "index.js");
    assert.equal(result.largestNormalChunk.name, "vendor.js");
    assert.equal(result.exceljs.name, "exceljs.min-test.js");
    assert.deepEqual(result.initialReferences, ["index.js", "vendor.js"]);
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("formats a comparable headroom summary without treating ExcelJS as initial load", () => {
  const summary = formatFrontendBundleSummary({
    entrypoint: { name: "index.js", bytes: 125_000 },
    largestNormalChunk: { name: "vendor.js", bytes: 250_000 },
    exceljs: { name: "exceljs.min-test.js", bytes: 900_000 },
  });

  assert.match(summary, /Entrypoint.*index\.js.*125\.00 kB.*375\.00 kB.*25\.00%/s);
  assert.match(summary, /Largest normal chunk.*vendor\.js.*250\.00 kB.*250\.00 kB.*50\.00%/s);
  assert.match(summary, /ExcelJS \(lazy\).*900\.00 kB.*100\.00 kB.*90\.00%/s);
  assert.match(summary, /ExcelJS is intentionally excluded from the initial page load/);
});

test("fails when the entrypoint exceeds the normal chunk budget", async () => {
  const publicDir = await makeBundle({
    entrypointBytes: DEFAULT_FRONTEND_CHUNK_MAX_BYTES + 1,
  });
  try {
    await assert.rejects(
      inspectFrontendBundle(publicDir, { logger: { log() {} } }),
      /entrypoint "index\.js".*above the/,
    );
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("fails when a normal chunk exceeds the normal chunk budget", async () => {
  const publicDir = await makeBundle({
    normalChunkBytes: DEFAULT_FRONTEND_CHUNK_MAX_BYTES + 1,
  });
  try {
    await assert.rejects(
      inspectFrontendBundle(publicDir, { logger: { log() {} } }),
      /normal frontend chunk "vendor\.js".*above the/,
    );
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("allows the known ExcelJS chunk only within its separate budget", async () => {
  const publicDir = await makeBundle({
    exceljsBytes: DEFAULT_EXCELJS_CHUNK_MAX_BYTES,
  });
  try {
    await assert.doesNotReject(
      inspectFrontendBundle(publicDir, { logger: { log() {} } }),
    );
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("fails if ExcelJS is added to the initial page load", async () => {
  const publicDir = await makeBundle({ preloadExceljs: true });
  try {
    await assert.rejects(
      inspectFrontendBundle(publicDir, { logger: { log() {} } }),
      /ExcelJS chunk "exceljs\.min-test\.js".*initial page load/,
    );
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test("fails if the ExcelJS chunk exceeds its separate budget", async () => {
  const publicDir = await makeBundle({
    exceljsBytes: DEFAULT_EXCELJS_CHUNK_MAX_BYTES + 1,
  });
  try {
    await assert.rejects(
      inspectFrontendBundle(publicDir, { logger: { log() {} } }),
      /allowlisted ExcelJS chunk "exceljs\.min-test\.js".*above the/,
    );
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});