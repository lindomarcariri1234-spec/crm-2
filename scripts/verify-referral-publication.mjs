import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  getPublicationVersions,
  readPublicationVersion,
} from "./publication-marker.mjs";

export const FIRST_PURCHASE_REFERRAL_MESSAGE =
  "Este benefício vale apenas para a primeira compra concluída deste cliente. O código continua válido para outros clientes.";

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "VisiteCRM-referral-publication-smoke-test";
const DEFAULT_VERSION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/visitecrm/dist/public/.publication-version",
);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not configured; provide a public storefront fixture before running the referral publication smoke test.`,
    );
  }
  return value;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("PUBLICATION_SMOKE_URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function getTimeoutMs() {
  const configured = Number(process.env["PUBLICATION_REFERRAL_TIMEOUT_MS"]);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

function getScriptReferences(body) {
  const references = new Set();
  const pattern =
    /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi;

  for (const match of body.matchAll(pattern)) {
    references.add(match[1]);
  }
  return [...references];
}

function getJavaScriptReferences(body) {
  const references = new Set();
  const dynamicImportPattern =
    /import\s*\(\s*["'`]([^"'`\\\r\n]+\.js(?:\?[^"'`\\\r\n]*)?)["'`]\s*\)/g;
  const viteChunkReferencePattern =
    /["'`](assets\/[^"'`\\\r\n]+\.js(?:\?[^"'`\\\r\n]*)?)["'`]/g;

  for (const pattern of [dynamicImportPattern, viteChunkReferencePattern]) {
    for (const match of body.matchAll(pattern)) {
      references.add(match[1]);
    }
  }
  return [...references];
}

function resolveSameOriginAsset(reference, sourceUrl, expectedOrigin) {
  let assetUrl;
  try {
    assetUrl = new URL(
      reference.startsWith("assets/") ? `/${reference}` : reference,
      sourceUrl,
    );
  } catch {
    return null;
  }

  if (assetUrl.origin !== expectedOrigin || !assetUrl.pathname.endsWith(".js")) {
    return null;
  }
  return assetUrl;
}

async function fetchText(url, timeoutMs, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": USER_AGENT },
  });
  return {
    response,
    finalUrl: new URL(response.url || url.href),
    body: await response.text(),
  };
}

function checkPublicationMarker(body, expectedVersion, source) {
  const versions = getPublicationVersions(body);
  if (versions.length !== 1 || !versions[0]) {
    return `${source} must contain exactly one publication marker`;
  }
  if (versions[0] !== expectedVersion) {
    return `${source} serves publication "${versions[0]}" instead of expected "${expectedVersion}"`;
  }
  return null;
}

async function crawlRoute({
  route,
  url,
  expectedOrigin,
  expectedVersion,
  timeoutMs,
  fetchImpl,
  assetBodies,
}) {
  const failures = [];
  const pending = [];
  const visited = new Set();
  let documentBody = "";

  try {
    const result = await fetchText(url, timeoutMs, fetchImpl);
    if (result.finalUrl.origin !== expectedOrigin) {
      failures.push(`${route}: document redirected to an unexpected origin`);
    }
    if (result.response.status !== 200) {
      failures.push(`${route}: expected HTTP 200, received HTTP ${result.response.status}`);
    } else {
      documentBody = result.body;
      const markerFailure = checkPublicationMarker(
        documentBody,
        expectedVersion,
        `${route} document`,
      );
      if (markerFailure) failures.push(markerFailure);

      for (const reference of getScriptReferences(documentBody)) {
        const assetUrl = resolveSameOriginAsset(
          reference,
          result.finalUrl,
          expectedOrigin,
        );
        if (assetUrl) pending.push(assetUrl);
      }
    }
  } catch (error) {
    failures.push(
      `${route}: document request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  while (pending.length > 0) {
    const assetUrl = pending.shift();
    if (!assetUrl || visited.has(assetUrl.href)) continue;
    visited.add(assetUrl.href);

    try {
      const result = await fetchText(assetUrl, timeoutMs, fetchImpl);
      const contentType = result.response.headers?.get?.("content-type") ?? "";
      if (
        result.finalUrl.origin !== expectedOrigin ||
        result.response.status < 200 ||
        result.response.status >= 300 ||
        !/^(?:application|text)\/(?:java|ecma)script(?:\s*;|$)/i.test(
          contentType.trim(),
        )
      ) {
        failures.push(
          `${route}: JavaScript asset failed with HTTP ${result.response.status} (${contentType || "missing content type"})`,
        );
        continue;
      }

      assetBodies.push(result.body);
      for (const reference of getJavaScriptReferences(result.body)) {
        const childUrl = resolveSameOriginAsset(
          reference,
          result.finalUrl,
          expectedOrigin,
        );
        if (childUrl && !visited.has(childUrl.href)) pending.push(childUrl);
      }
    } catch (error) {
      failures.push(
        `${route}: JavaScript asset request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { route, failures, documentBody };
}

export async function verifyReferralPublication({
  publicUrl = process.env["PUBLICATION_SMOKE_URL"],
  expectedVersion,
  versionPath = DEFAULT_VERSION_PATH,
  storeSlug = process.env["PUBLICATION_REFERRAL_STORE_SLUG"],
  referralCode = process.env["PUBLICATION_REFERRAL_CODE"],
  productSlug = process.env["PUBLICATION_REFERRAL_PRODUCT_SLUG"],
  timeoutMs = getTimeoutMs(),
  fetchImpl = fetch,
} = {}) {
  if (!publicUrl?.trim()) {
    throw new Error(
      "PUBLICATION_SMOKE_URL is not configured; provide the URL returned by the publication before running the referral publication smoke test.",
    );
  }
  const baseUrl = normalizeBaseUrl(publicUrl);
  const resolvedExpectedVersion =
    expectedVersion?.trim() ||
    (await readPublicationVersion(
      versionPath,
      "Expected storefront publication version",
    ));
  const resolvedStoreSlug = storeSlug?.trim() || requiredEnvironment("PUBLICATION_REFERRAL_STORE_SLUG");
  const resolvedReferralCode =
    referralCode?.trim() || requiredEnvironment("PUBLICATION_REFERRAL_CODE");
  const resolvedProductSlug =
    productSlug?.trim() || requiredEnvironment("PUBLICATION_REFERRAL_PRODUCT_SLUG");
  const paths = {
    referralPath: `/loja/${encodeURIComponent(resolvedStoreSlug)}/indicacao?code=${encodeURIComponent(resolvedReferralCode)}`,
    checkoutPath: `/loja/${encodeURIComponent(resolvedStoreSlug)}/checkout`,
    wizardPath: `/loja/${encodeURIComponent(resolvedStoreSlug)}/reservar/${encodeURIComponent(resolvedProductSlug)}?ref=${encodeURIComponent(resolvedReferralCode)}`,
    apiPath: `/api/public/store/${encodeURIComponent(resolvedStoreSlug)}/referral/info?code=${encodeURIComponent(resolvedReferralCode)}`,
  };
  const assetBodies = [];
  const routeResults = await Promise.all(
    [
      ["referral-landing", paths.referralPath],
      ["checkout-direct", paths.checkoutPath],
      ["reservation-wizard", paths.wizardPath],
    ].map(([route, pathname]) =>
      crawlRoute({
        route,
        url: new URL(pathname, baseUrl),
        expectedOrigin: baseUrl.origin,
        expectedVersion: resolvedExpectedVersion,
        timeoutMs,
        fetchImpl,
        assetBodies,
      }),
    ),
  );

  const apiResult = await (async () => {
    try {
      const result = await fetchText(new URL(paths.apiPath, baseUrl), timeoutMs, fetchImpl);
      if (result.finalUrl.origin !== baseUrl.origin) {
        return { name: "referral-info", ok: false, message: "API redirected to an unexpected origin" };
      }
      if (result.response.status !== 200) {
        return { name: "referral-info", ok: false, message: `API expected HTTP 200, received HTTP ${result.response.status}` };
      }

      let payload;
      try {
        payload = JSON.parse(result.body);
      } catch {
        return { name: "referral-info", ok: false, message: "API returned invalid JSON" };
      }
      if (payload?.firstPurchaseOnly !== true) {
        return { name: "referral-info", ok: false, message: "API response does not confirm firstPurchaseOnly=true" };
      }
      return { name: "referral-info", ok: true, message: "API confirmed firstPurchaseOnly=true" };
    } catch (error) {
      return {
        name: "referral-info",
        ok: false,
        message: `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  })();

  const bundleText = assetBodies.join("\n");
  const bundleResult = {
    name: "referral-message-bundle",
    ok:
      bundleText.includes(FIRST_PURCHASE_REFERRAL_MESSAGE) &&
      /role\s*:\s*["']note["']/.test(bundleText),
    message:
      bundleText.includes(FIRST_PURCHASE_REFERRAL_MESSAGE) &&
      /role\s*:\s*["']note["']/.test(bundleText)
        ? "bundle contains the first-purchase explanation with role=note"
        : "bundle is missing the first-purchase explanation or role=note",
  };

  return [
    ...routeResults.map((result) => ({
      name: result.route,
      ok: result.failures.length === 0,
      message:
        result.failures.length === 0
          ? "HTTP 200, expected publication marker, and JavaScript assets confirmed"
          : result.failures.join("; "),
    })),
    apiResult,
    bundleResult,
  ];
}

async function main() {
  const expectedVersion =
    process.env["PUBLICATION_EXPECTED_VERSION"]?.trim() ||
    (await readPublicationVersion(
      DEFAULT_VERSION_PATH,
      "Expected storefront publication version",
    ));
  const results = await verifyReferralPublication({ expectedVersion });
  let failed = false;

  for (const result of results) {
    console.log(
      `[referral-publication] ${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.message}`,
    );
    failed ||= !result.ok;
  }
  if (failed) {
    throw new Error(
      "Referral publication smoke test failed. The current storefront publication is not the expected build or does not expose the first-purchase policy.",
    );
  }
  console.log("[referral-publication] Referral publication confirmed successfully.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `[referral-publication] ERROR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}