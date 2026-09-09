import { pathToFileURL } from "node:url";
import {
  getPublicationVersions,
  PUBLICATION_VERSION_PLACEHOLDER,
} from "./publication-marker.mjs";

const EXPECTED_STOREFRONT_TITLE = "VisiteCRM — CRM para Agências de Viagem";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 1;
const DEFAULT_RETRY_DELAY_MS = 0;
function normalizePublicUrl(
  configuredUrl,
  variableName,
  { requireHttps = false, valueDescription = "the public storefront URL" } = {},
) {
  if (!configuredUrl?.trim()) {
    throw new Error(
      `${variableName} is not configured; set it to ${valueDescription} before running the publication smoke test.`,
    );
  }

  const url = new URL(configuredUrl);
  if (requireHttps && url.protocol !== "https:") {
    throw new Error(`${variableName} must use HTTPS; HTTPS is required for the canonical publication origin.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function getPublicUrl() {
  const configuredUrl =
    process.env["PUBLICATION_SMOKE_URL"] ??
    process.env["FRONTEND_URL"] ??
    process.env["VITE_APP_URL"];

  return normalizePublicUrl(configuredUrl, "PUBLICATION_SMOKE_URL");
}

function getCanonicalUrl() {
  const configuredUrl = process.env["PUBLICATION_CANONICAL_URL"];
  return normalizePublicUrl(configuredUrl, "PUBLICATION_CANONICAL_URL", {
    requireHttps: true,
    valueDescription: "the canonical publication URL",
  });
}

function getTimeoutMs() {
  const configuredTimeout = Number(process.env["PUBLICATION_SMOKE_TIMEOUT_MS"]);
  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return configuredTimeout;
}

function getAttempts() {
  const configuredAttempts = Number(process.env["PUBLICATION_SMOKE_ATTEMPTS"]);
  if (!Number.isInteger(configuredAttempts) || configuredAttempts <= 0) {
    return DEFAULT_ATTEMPTS;
  }
  return configuredAttempts;
}

function getRetryDelayMs() {
  const configuredDelay = Number(process.env["PUBLICATION_SMOKE_RETRY_DELAY_MS"]);
  if (!Number.isFinite(configuredDelay) || configuredDelay < 0) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return configuredDelay;
}

function getExpectedPublicationVersion() {
  const configuredVersion = process.env["PUBLICATION_EXPECTED_VERSION"];
  return configuredVersion?.trim() || undefined;
}

function urlsMatch(left, right) {
  return left.href === right.href;
}

async function waitBeforeRetry(delayMs) {
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function fetchText(url, timeoutMs, fetchImpl) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    signal,
    headers: {
      "User-Agent": "VisiteCRM-publication-smoke-test",
    },
  });
  return {
    response,
    finalUrl: new URL(response.url || url.href),
    body: await response.text(),
  };
}

async function runCheckWithRetry(name, check, { attempts, retryDelayMs }) {
  let lastResult;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResult = await check();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastResult = {
        name,
        ok: false,
        message: `request failed: ${message}`,
      };
    }

    if (lastResult.ok) {
      if (attempt === 1) return lastResult;
      return {
        ...lastResult,
        message: `${lastResult.message} (attempt ${attempt}/${attempts})`,
      };
    }

    if (attempt < attempts) {
      await waitBeforeRetry(retryDelayMs);
    }
  }

  if (attempts === 1) return lastResult;
  return {
    ...lastResult,
    message: `${lastResult.message} (failed after ${attempts} attempts)`,
  };
}

function getUnexpectedOriginMessage(requestedUrl, finalUrl, expectedOrigin) {
  return `expected final origin ${expectedOrigin} for ${requestedUrl}, but HTTP followed redirect to ${finalUrl}`;
}

function getPublicationVersion(body) {
  const versions = getPublicationVersions(body);
  if (versions.length > 1) {
    throw new Error(
      "response contains multiple publication identity markers; exactly one is required",
    );
  }
  const version = versions[0];
  if (!version || version === PUBLICATION_VERSION_PLACEHOLDER) return undefined;
  return version;
}

function getPublicationMismatchMessage(expectedVersion, actualVersion, finalUrl) {
  return (
    `expected publication version "${expectedVersion}" at ${finalUrl}, ` +
    `but the response contained "${actualVersion ?? "missing"}"`
  );
}

async function checkStorefront(publicUrl, expectedOrigin, expectedVersion, timeoutMs, fetchImpl) {
  const { response, finalUrl, body } = await fetchText(publicUrl, timeoutMs, fetchImpl);
  if (expectedOrigin && finalUrl.origin !== expectedOrigin) {
    return {
      name: "storefront",
      ok: false,
      message: getUnexpectedOriginMessage(publicUrl, finalUrl, expectedOrigin),
    };
  }
  if (response.status !== 200) {
    return {
      name: "storefront",
      ok: false,
      message: `expected HTTP 200 from ${publicUrl}, but HTTP followed to ${finalUrl} and received HTTP ${response.status}`,
    };
  }
  const actualVersion = getPublicationVersion(body);
  if (!actualVersion) {
    return {
      name: "storefront",
      ok: false,
      message: expectedVersion
        ? getPublicationMismatchMessage(expectedVersion, actualVersion, finalUrl)
        : `expected a publication identity marker at ${finalUrl}, but the response contained "missing"`,
    };
  }
  if (expectedVersion && actualVersion !== expectedVersion) {
    return {
      name: "storefront",
      ok: false,
      message: getPublicationMismatchMessage(expectedVersion, actualVersion, finalUrl),
    };
  }
  if (!body.includes(EXPECTED_STOREFRONT_TITLE)) {
    return {
      name: "storefront",
      ok: false,
      message: `HTTP 200 received after following ${publicUrl} to ${finalUrl}, but the expected title marker "${EXPECTED_STOREFRONT_TITLE}" was not found`,
    };
  }
  return {
    name: "storefront",
    ok: true,
    message: `HTTP 200 and title marker confirmed at ${finalUrl}`,
  };
}

async function checkHealth(publicUrl, expectedOrigin, timeoutMs, fetchImpl) {
  const healthUrl = new URL("/api/healthz", publicUrl);
  const { response, finalUrl, body } = await fetchText(healthUrl, timeoutMs, fetchImpl);
  if (expectedOrigin && finalUrl.origin !== expectedOrigin) {
    return {
      name: "healthz",
      ok: false,
      message: getUnexpectedOriginMessage(healthUrl, finalUrl, expectedOrigin),
    };
  }
  if (response.status !== 200) {
    return {
      name: "healthz",
      ok: false,
      message: `expected HTTP 200 from ${healthUrl}, but HTTP followed to ${finalUrl} and received HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      name: "healthz",
      ok: false,
      message: `HTTP 200 received after following ${healthUrl} to ${finalUrl}, but the response was not valid JSON`,
    };
  }

  if (payload?.status !== "ok") {
    return {
      name: "healthz",
      ok: false,
      message: `HTTP 200 received after following ${healthUrl} to ${finalUrl}, but health status is "${String(payload?.status ?? "missing")}"`,
    };
  }

  return {
    name: "healthz",
    ok: true,
    message: `HTTP 200 and health status "ok" confirmed at ${finalUrl}`,
  };
}

export async function verifyPublication({
  publicUrl = getPublicUrl(),
  canonicalUrl = getCanonicalUrl(),
  timeoutMs = getTimeoutMs(),
  attempts = getAttempts(),
  retryDelayMs = getRetryDelayMs(),
  expectedVersion = getExpectedPublicationVersion(),
  fetchImpl = fetch,
} = {}) {
  const normalizedPublicUrl =
    publicUrl instanceof URL ? publicUrl : normalizePublicUrl(publicUrl, "PUBLICATION_SMOKE_URL");
  const normalizedCanonicalUrl = normalizePublicUrl(
    canonicalUrl instanceof URL ? canonicalUrl.href : canonicalUrl,
    "PUBLICATION_CANONICAL_URL",
    {
      requireHttps: true,
      valueDescription: "the canonical publication URL",
    },
  );
  const expectedOrigin = normalizedCanonicalUrl?.origin;
  const checks = [
    {
      name: "storefront",
      run: () => checkStorefront(normalizedPublicUrl, expectedOrigin, expectedVersion, timeoutMs, fetchImpl),
    },
    {
      name: "healthz",
      run: () => checkHealth(normalizedPublicUrl, expectedOrigin, timeoutMs, fetchImpl),
    },
  ];

  if (normalizedCanonicalUrl && !urlsMatch(normalizedPublicUrl, normalizedCanonicalUrl)) {
    checks.push(
      {
        name: "canonical-storefront",
        run: () => checkStorefront(normalizedCanonicalUrl, expectedOrigin, expectedVersion, timeoutMs, fetchImpl),
      },
      {
        name: "canonical-healthz",
        run: () => checkHealth(normalizedCanonicalUrl, expectedOrigin, timeoutMs, fetchImpl),
      },
    );
  }

  const results = await Promise.allSettled(
    checks.map(({ name, run }) => runCheckWithRetry(name, run, { attempts, retryDelayMs })),
  );

  return results.map((result, index) => {
    const name = checks[index].name;
    if (result.status === "fulfilled") return { ...result.value, name };
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      name,
      ok: false,
      message: `request failed: ${error}`,
    };
  });
}

async function main() {
  const publicUrl = getPublicUrl();
  const canonicalUrl = getCanonicalUrl();
  const expectedVersion = getExpectedPublicationVersion();
  if (!expectedVersion) {
    throw new Error(
      "PUBLICATION_EXPECTED_VERSION is not configured; set it to the version produced by the current build before running the publication smoke test.",
    );
  }
  const canonicalSuffix = canonicalUrl ? ` and canonical Vercel domain at ${canonicalUrl}` : "";
  console.log(
    `[publication-smoke] Checking publication version "${expectedVersion}" at ${publicUrl}${canonicalSuffix}`,
  );
  const results = await verifyPublication({ publicUrl, canonicalUrl, expectedVersion });
  let failed = false;

  for (const result of results) {
    const prefix = result.ok ? "PASS" : "FAIL";
    console.log(`[publication-smoke] ${prefix} ${result.name}: ${result.message}`);
    failed ||= !result.ok;
  }

  if (failed) {
    throw new Error(
      "Publication smoke test failed. The storefront and API must pass before this deployment is considered ready.",
    );
  }
  console.log("[publication-smoke] Publication confirmed successfully.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[publication-smoke] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}