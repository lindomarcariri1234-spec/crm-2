import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPublicationVersion,
  PUBLICATION_VERSION_PLACEHOLDER,
} from "./publication-marker.mjs";
import {
  getBuiltPublicationVersion,
  getLocalPublicationVersion,
} from "./start-production.mjs";
import { verifyPublication } from "./verify-publication.mjs";
import { verifyFrontendPublication } from "../artifacts/api-server/scripts/run-vercel-build.mjs";

const STOREFRONT_TITLE = "VisiteCRM — CRM para Agências de Viagem";
const PUBLICATION_META = "visitecrm-publication";
const CURRENT_VERSION = "current-build-sha";

function storefrontBody(version = CURRENT_VERSION) {
  return `<meta name="${PUBLICATION_META}" content="${version}"><title>${STOREFRONT_TITLE}</title>`;
}

function storefrontBodyWithContentFirst(version = CURRENT_VERSION) {
  return `<meta content="${version}" name="${PUBLICATION_META}"><title>${STOREFRONT_TITLE}</title>`;
}

function storefrontBodyWithUnexpectedFormatting(version = CURRENT_VERSION) {
  return `<META
    data-note="contains > in a quoted value"
    content = '${version}'
    name = "${PUBLICATION_META}"
  ><title>${STOREFRONT_TITLE}</title>`;
}

function response(status, body, url) {
  return {
    status,
    url,
    text: async () => body,
  };
}

function successfulFetch(version = CURRENT_VERSION) {
  return async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/healthz") {
      return response(200, JSON.stringify({ status: "ok" }), url.href);
    }
    return response(200, storefrontBody(version), url.href);
  };
}

function fetchWithStorefrontBody(body) {
  return async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/healthz") {
      return response(200, JSON.stringify({ status: "ok" }), url.href);
    }
    return response(200, body, url.href);
  };
}

function runPublicationMarker(indexPath, expectedVersion) {
  return new Promise((resolve, reject) => {
    const scriptPath = fileURLToPath(
      new URL("./publication-marker.mjs", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        indexPath,
        ...(expectedVersion === undefined ? [] : [expectedVersion]),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runProductionLauncher({
  indexPath,
  apiEntrypoint,
  expectedVersion,
  publicationVersionPath,
  startedMarkerPath,
}) {
  return new Promise((resolve, reject) => {
    const launcherPath = fileURLToPath(
      new URL("./start-production.mjs", import.meta.url),
    );
    const env = {
      ...process.env,
      NODE_ENV: "production",
      PUBLICATION_INDEX_PATH: indexPath,
      PUBLICATION_API_ENTRYPOINT: apiEntrypoint,
      PUBLICATION_STARTUP_TIMEOUT_MS: "25",
      PORT: "49876",
      STARTED_MARKER: startedMarkerPath,
      PUBLICATION_CANONICAL_URL: "",
      PUBLICATION_SMOKE_URL: "",
    };
    if (expectedVersion === undefined) {
      delete env.PUBLICATION_EXPECTED_VERSION;
    } else {
      env.PUBLICATION_EXPECTED_VERSION = expectedVersion;
    }
    if (publicationVersionPath !== undefined) {
      env.PUBLICATION_VERSION_PATH = publicationVersionPath;
    }

    const child = spawn(process.execPath, [launcherPath], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function wasStarted(markerPath) {
  try {
    await readFile(markerPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

test("requires the canonical publication URL to be configured", async () => {
  const previousCanonicalUrl = process.env["PUBLICATION_CANONICAL_URL"];
  delete process.env["PUBLICATION_CANONICAL_URL"];
  let fetchCalled = false;

  try {
    await assert.rejects(
      verifyPublication({
        publicUrl: "https://visitecrm.com",
        fetchImpl: async () => {
          fetchCalled = true;
          return successfulFetch()("https://visitecrm.com");
        },
      }),
      {
        message:
          "PUBLICATION_CANONICAL_URL is not configured; set it to the canonical publication URL before running the publication smoke test.",
      },
    );
    assert.equal(fetchCalled, false);
  } finally {
    if (previousCanonicalUrl === undefined) {
      delete process.env["PUBLICATION_CANONICAL_URL"];
    } else {
      process.env["PUBLICATION_CANONICAL_URL"] = previousCanonicalUrl;
    }
  }
});

test("verifies valid redirects to the canonical origin", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url.href);
    const finalUrl = new URL(
      url.href.replace(url.origin, "https://visitecrm.com"),
    );
    return successfulFetch()(finalUrl);
  };

  const results = await verifyPublication({
    publicUrl: "https://crm-2-lindomarcariri.replit.app",
    canonicalUrl: "https://visitecrm.com",
    fetchImpl,
  });

  assert.deepEqual(
    results.map(({ name, ok }) => ({ name, ok })),
    [
      { name: "storefront", ok: true },
      { name: "healthz", ok: true },
      { name: "canonical-storefront", ok: true },
      { name: "canonical-healthz", ok: true },
    ],
  );
  assert.match(results[0].message, /https:\/\/visitecrm\.com\//);
  assert.deepEqual(calls.sort(), [
    "https://crm-2-lindomarcariri.replit.app/",
    "https://crm-2-lindomarcariri.replit.app/api/healthz",
    "https://visitecrm.com/",
    "https://visitecrm.com/api/healthz",
  ]);
});

test("rejects an HTTP canonical origin because HTTPS is required", async () => {
  await assert.rejects(
    verifyPublication({
      publicUrl: "https://crm-2-lindomarcariri.replit.app",
      canonicalUrl: "http://visitecrm.com",
      fetchImpl: successfulFetch(),
    }),
    {
      message:
        "PUBLICATION_CANONICAL_URL must use HTTPS; HTTPS is required for the canonical publication origin.",
    },
  );
});

test("retries a transient canonical failure and reports the successful attempt", async () => {
  let canonicalHomepageCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "visitecrm.com" && url.pathname === "/") {
      canonicalHomepageCalls += 1;
      if (canonicalHomepageCalls === 1)
        return response(503, "deploying", url.href);
    }
    return successfulFetch()(input);
  };

  const results = await verifyPublication({
    publicUrl: "https://crm-2-lindomarcariri.replit.app",
    canonicalUrl: "https://visitecrm.com",
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl,
  });

  const canonicalStorefront = results.find(
    (result) => result.name === "canonical-storefront",
  );
  assert.equal(canonicalStorefront?.ok, true);
  assert.match(canonicalStorefront?.message ?? "", /attempt 2\/2/);
  assert.equal(canonicalHomepageCalls, 2);
});

test("rejects a redirect to an unexpected origin for the storefront and health endpoint", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "crm-2-lindomarcariri.replit.app") {
      const unexpectedUrl = new URL(
        url.href.replace(url.origin, "https://unexpected.example"),
      );
      return successfulFetch()(unexpectedUrl);
    }
    return successfulFetch()(input);
  };

  const results = await verifyPublication({
    publicUrl: "https://crm-2-lindomarcariri.replit.app",
    canonicalUrl: "https://visitecrm.com",
    fetchImpl,
  });

  assert.equal(
    results.find((result) => result.name === "storefront")?.ok,
    false,
  );
  assert.match(
    results.find((result) => result.name === "storefront")?.message ?? "",
    /followed redirect to https:\/\/unexpected\.example\//,
  );
  assert.equal(results.find((result) => result.name === "healthz")?.ok, false);
  assert.match(
    results.find((result) => result.name === "healthz")?.message ?? "",
    /followed redirect to https:\/\/unexpected\.example\/api\/healthz/,
  );
  assert.equal(
    results.find((result) => result.name === "canonical-storefront")?.ok,
    true,
  );
  assert.equal(
    results.find((result) => result.name === "canonical-healthz")?.ok,
    true,
  );
});

test("does not duplicate checks when both configured URLs are the same origin", async () => {
  let calls = 0;
  const fetchImpl = async (input) => {
    calls += 1;
    return successfulFetch()(input);
  };

  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com/",
    canonicalUrl: "https://visitecrm.com",
    fetchImpl,
  });

  assert.deepEqual(
    results.map(({ name }) => name),
    ["storefront", "healthz"],
  );
  assert.equal(calls, 2);
});

test("rejects a public storefront from an older publication", async () => {
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: successfulFetch("previous-build-sha"),
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(
    storefront?.message ?? "",
    /expected publication version "current-build-sha".*contained "previous-build-sha"/,
  );
});

test("reports a missing publication identity marker", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/healthz") {
      return response(200, JSON.stringify({ status: "ok" }), url.href);
    }
    return response(200, `<title>${STOREFRONT_TITLE}</title>`, url.href);
  };

  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl,
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(storefront?.message ?? "", /contained "missing"/);
});

test("rejects a storefront without a publication identity marker even without an expected commit", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/healthz") {
      return response(200, JSON.stringify({ status: "ok" }), url.href);
    }
    return response(200, `<title>${STOREFRONT_TITLE}</title>`, url.href);
  };

  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    fetchImpl,
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(
    storefront?.message ?? "",
    /expected a publication identity marker .*contained "missing"/,
  );
});

test("rejects a public storefront with an unsubstituted publication identity marker", async () => {
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: fetchWithStorefrontBody(
      storefrontBody(PUBLICATION_VERSION_PLACEHOLDER),
    ),
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(
    storefront?.message ?? "",
    /expected publication version "current-build-sha".*contained "missing"/,
  );
});

test("accepts a public publication marker when content appears before name", async () => {
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: fetchWithStorefrontBody(
      storefrontBodyWithContentFirst(CURRENT_VERSION),
    ),
  });

  assert.equal(
    results.find((result) => result.name === "storefront")?.ok,
    true,
  );
});

test("accepts a public publication marker with unexpected attribute formatting", async () => {
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: fetchWithStorefrontBody(
      storefrontBodyWithUnexpectedFormatting(CURRENT_VERSION),
    ),
  });

  assert.equal(
    results.find((result) => result.name === "storefront")?.ok,
    true,
  );
});

test("rejects comments, decoy tags, and false attributes in a public storefront", async () => {
  const body = `
    <!-- <meta name="${PUBLICATION_META}" content="${CURRENT_VERSION}"> -->
    <meta data-note="name='${PUBLICATION_META}' content='${CURRENT_VERSION}'">
    <meta name="${PUBLICATION_META}" data-content="${CURRENT_VERSION}">
    <div name="${PUBLICATION_META}" content="${CURRENT_VERSION}"></div>
    <title>${STOREFRONT_TITLE}</title>
  `;
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: fetchWithStorefrontBody(body),
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(storefront?.message ?? "", /contained "missing"/);
});

test("rejects duplicate publication identity markers in a public storefront", async () => {
  const results = await verifyPublication({
    publicUrl: "https://visitecrm.com",
    canonicalUrl: "https://visitecrm.com",
    expectedVersion: CURRENT_VERSION,
    fetchImpl: fetchWithStorefrontBody(
      `${storefrontBody("build-sha-first")}${storefrontBody("build-sha-second")}`,
    ),
  });

  const storefront = results.find((result) => result.name === "storefront");
  assert.equal(storefront?.ok, false);
  assert.match(
    storefront?.message ?? "",
    /multiple publication identity markers; exactly one is required/,
  );
});

test("extracts the publication identity from a local storefront artifact", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, storefrontBody("build-sha-123"), "utf8");

    assert.equal(await getLocalPublicationVersion(indexPath), "build-sha-123");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("accepts a local storefront artifact with the expected publication identity", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, storefrontBody(CURRENT_VERSION), "utf8");

    assert.equal(
      await getLocalPublicationVersion(indexPath, CURRENT_VERSION),
      CURRENT_VERSION,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a local storefront artifact with a divergent expected identity", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, storefrontBody("previous-build-sha"), "utf8");

    await assert.rejects(
      getLocalPublicationVersion(indexPath, CURRENT_VERSION),
      new RegExp(
        `expected publication version "${CURRENT_VERSION}" in .* but found "previous-build-sha"`,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("production launcher rejects a stale storefront before starting the API", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-production-launcher-"),
  );
  const indexPath = path.join(tempDir, "index.html");
  const apiEntrypoint = path.join(tempDir, "api.mjs");
  const startedMarkerPath = path.join(tempDir, "api-started");

  try {
    await writeFile(indexPath, storefrontBody("previous-build-sha"), "utf8");
    await writeFile(
      apiEntrypoint,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.STARTED_MARKER, "started");
process.exit(0);`,
      "utf8",
    );

    const result = await runProductionLauncher({
      indexPath,
      apiEntrypoint,
      expectedVersion: CURRENT_VERSION,
      startedMarkerPath,
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(await wasStarted(startedMarkerPath), false);
    assert.match(
      result.stderr,
      /expected publication version "current-build-sha" in .* but found "previous-build-sha"/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("production launcher starts the API when the storefront revision matches", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-production-launcher-"),
  );
  const indexPath = path.join(tempDir, "index.html");
  const apiEntrypoint = path.join(tempDir, "api.mjs");
  const startedMarkerPath = path.join(tempDir, "api-started");

  try {
    await writeFile(indexPath, storefrontBody(CURRENT_VERSION), "utf8");
    await writeFile(
      apiEntrypoint,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.STARTED_MARKER, "started");
process.exit(0);`,
      "utf8",
    );

    const result = await runProductionLauncher({
      indexPath,
      apiEntrypoint,
      expectedVersion: CURRENT_VERSION,
      startedMarkerPath,
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(await wasStarted(startedMarkerPath), true);
    assert.match(result.stderr, /API did not become healthy within/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("production launcher uses the revision recorded by the frontend build", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-production-launcher-"),
  );
  const indexPath = path.join(tempDir, "index.html");
  const publicationVersionPath = path.join(tempDir, ".publication-version");
  const apiEntrypoint = path.join(tempDir, "api.mjs");
  const startedMarkerPath = path.join(tempDir, "api-started");

  try {
    await writeFile(indexPath, storefrontBody(CURRENT_VERSION), "utf8");
    await writeFile(publicationVersionPath, `${CURRENT_VERSION}\n`, "utf8");
    await writeFile(
      apiEntrypoint,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.env.STARTED_MARKER, process.env.PUBLICATION_EXPECTED_VERSION);
process.exit(0);`,
      "utf8",
    );

    const result = await runProductionLauncher({
      indexPath,
      publicationVersionPath,
      apiEntrypoint,
      startedMarkerPath,
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(
      await readFile(startedMarkerPath, "utf8"),
      CURRENT_VERSION,
    );
    assert.match(result.stderr, /API did not become healthy within/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("extracts the publication identity when content appears before name", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(
      indexPath,
      storefrontBodyWithContentFirst("build-sha-456"),
      "utf8",
    );

    assert.equal(await getLocalPublicationVersion(indexPath), "build-sha-456");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("extracts the publication identity with unexpected attribute formatting", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(
      indexPath,
      storefrontBodyWithUnexpectedFormatting(),
      "utf8",
    );

    assert.equal(await getLocalPublicationVersion(indexPath), CURRENT_VERSION);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects decoy markup that is not a publication meta tag", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(
      indexPath,
      `<!-- <meta name="${PUBLICATION_META}" content="decoy"> -->
        <meta data-note="name='${PUBLICATION_META}' content='decoy'">
        <div name="${PUBLICATION_META}" content="${CURRENT_VERSION}"></div>`,
      "utf8",
    );

    await assert.rejects(
      getLocalPublicationVersion(indexPath),
      /is missing the publication identity marker/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects duplicate publication identity markers", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(
      indexPath,
      `${storefrontBody("build-sha-first")}${storefrontBody("build-sha-second")}`,
      "utf8",
    );

    await assert.rejects(
      getLocalPublicationVersion(indexPath),
      /contains multiple publication identity markers; exactly one is required/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a local storefront artifact without a publication identity marker", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, `<title>${STOREFRONT_TITLE}</title>`, "utf8");

    await assert.rejects(
      getLocalPublicationVersion(indexPath),
      /is missing the publication identity marker/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a local storefront artifact with an unsubstituted identity marker", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(
      indexPath,
      storefrontBody(PUBLICATION_VERSION_PLACEHOLDER),
      "utf8",
    );

    await assert.rejects(
      getLocalPublicationVersion(indexPath),
      new RegExp(
        `contains the unsubstituted marker "${PUBLICATION_VERSION_PLACEHOLDER}". Replace this marker during the storefront build before publishing.`,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("validates the built storefront publication marker without external services", () => {
  assert.equal(
    assertPublicationVersion(
      storefrontBody(CURRENT_VERSION),
      "Built storefront index at /tmp/index.html",
    ),
    CURRENT_VERSION,
  );

  assert.throws(
    () =>
      assertPublicationVersion(
        storefrontBody(PUBLICATION_VERSION_PLACEHOLDER),
        "Built storefront index at /tmp/index.html",
      ),
    new RegExp(
      `Built storefront index at /tmp/index\\.html contains the unsubstituted marker "${PUBLICATION_VERSION_PLACEHOLDER}". Replace this marker during the storefront build before publishing\\.`,
    ),
  );
});

test("standalone publication marker command validates the built index without external services", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, storefrontBody(CURRENT_VERSION), "utf8");

    const result = await runPublicationMarker(indexPath, CURRENT_VERSION);

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.match(
      result.stdout,
      new RegExp(
        `Publication version "${CURRENT_VERSION}" confirmed in ${indexPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("standalone publication marker command rejects a stale build revision", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );
  const indexPath = path.join(tempDir, "index.html");

  try {
    await writeFile(indexPath, storefrontBody("previous-build-sha"), "utf8");

    const result = await runPublicationMarker(indexPath, CURRENT_VERSION);

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^\[publication-marker\] ERROR: /);
    assert.match(
      result.stderr,
      new RegExp(
        `expected publication version "${CURRENT_VERSION}" in Published storefront index at .* but found "previous-build-sha"`,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("standalone publication marker command rejects an unavailable or invalid index with actionable errors", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-publication-"),
  );

  try {
    const cases = [
      {
        name: "missing index",
        body: null,
        expectedMessage: /Built storefront index is unavailable at .*ENOENT/,
      },
      {
        name: "empty index",
        body: "",
        expectedMessage: /Published storefront index at .* is missing the publication identity marker/,
      },
      {
        name: "index without marker",
        body: `<title>${STOREFRONT_TITLE}</title>`,
        expectedMessage: /Published storefront index at .* is missing the publication identity marker/,
      },
      {
        name: "index with an empty marker",
        body: storefrontBody("   "),
        expectedMessage: /Published storefront index at .* is missing the publication identity marker/,
      },
      {
        name: "index with an unsubstituted marker",
        body: storefrontBody(PUBLICATION_VERSION_PLACEHOLDER),
        expectedMessage: new RegExp(
          `Published storefront index at .* contains the unsubstituted marker "${PUBLICATION_VERSION_PLACEHOLDER}". Replace this marker during the storefront build before publishing.`,
        ),
      },
      {
        name: "index with duplicate markers",
        body: `${storefrontBody("build-sha-first")}${storefrontBody("build-sha-second")}`,
        expectedMessage: /Published storefront index at .* contains multiple publication identity markers; exactly one is required/,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const indexPath = path.join(tempDir, `${index}-${testCase.name}.html`);
      if (testCase.body !== null) {
        await writeFile(indexPath, testCase.body, "utf8");
      }

      const result = await runPublicationMarker(indexPath);

      assert.equal(result.code, 1, testCase.name);
      assert.equal(result.signal, null, testCase.name);
      assert.equal(result.stdout, "", testCase.name);
      assert.match(result.stderr, /^\[publication-marker\] ERROR: /, testCase.name);
      assert.match(result.stderr, testCase.expectedMessage, testCase.name);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Vercel frontend copies preserve the revision from the frontend metadata", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-vercel-publication-"),
  );
  const sourceDir = path.join(tempDir, "source");
  const copiedDir = path.join(tempDir, "copied");

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "index.html"),
      storefrontBody(CURRENT_VERSION),
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, ".publication-version"),
      `${CURRENT_VERSION}\n`,
      "utf8",
    );

    await cp(sourceDir, copiedDir, { recursive: true });

    assert.equal(await verifyFrontendPublication(copiedDir), CURRENT_VERSION);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Vercel frontend validation rejects divergent HTML and metadata revisions", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-vercel-publication-"),
  );

  try {
    await writeFile(
      path.join(tempDir, "index.html"),
      storefrontBody("previous-build-sha"),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".publication-version"),
      `${CURRENT_VERSION}\n`,
      "utf8",
    );

    await assert.rejects(
      verifyFrontendPublication(tempDir),
      new RegExp(
        `expected publication version "${CURRENT_VERSION}" in .* but found "previous-build-sha"`,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Vercel frontend validation rejects a copy that loses the revision metadata", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "visitecrm-vercel-publication-"),
  );

  try {
    await writeFile(
      path.join(tempDir, "index.html"),
      storefrontBody(CURRENT_VERSION),
      "utf8",
    );

    await assert.rejects(
      verifyFrontendPublication(tempDir),
      /Vercel storefront publication version is unavailable at .*ENOENT/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
