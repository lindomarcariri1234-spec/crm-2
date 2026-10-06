import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { get } from "node:http";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PUBLIC_PATH = "/";
const CLERK_BACKEND_API_URL = "https://api.clerk.com/v1/";
const CLERK_SIGN_IN_TOKEN_TTL_SECONDS = 300;
const DEFAULT_PROTECTED_PATH = "/dashboard";
const DEFAULT_PROTECTED_PATHS = [
  "/dashboard",
  "/pipeline",
  "/clients",
  "/trips",
  "/reservations",
  "/financeiro",
  "/analytics",
  "/configuracoes",
];
const DEFAULT_INTERACTION_SELECTORS = [
  '[role="tab"]',
  'button[aria-haspopup="menu"]',
];
const PROFILE_ENVIRONMENTS = [
  {
    name: "seller",
    label: "vendedor",
    pathEnvironmentVariable: "PUBLICATION_CHUNK_SELLER_PATHS",
    userIdEnvironmentVariable: "PUBLICATION_CHUNK_SELLER_USER_ID",
    defaultPath: "/meu-painel",
  },
  {
    name: "superadmin",
    label: "superadmin",
    pathEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_PATHS",
    userIdEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_USER_ID",
    defaultPath: "/admin",
  },
  {
    name: "client",
    label: "cliente",
    pathEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_PATHS",
    userIdEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_USER_ID",
    defaultPath: "/perfil",
  },
];
const USER_AGENT = "VisiteCRM-publication-chunk-smoke-test";
const ROUTER_SOURCE_PATH = "artifacts/visitecrm/src/App.tsx";
const NAVIGATION_SOURCE_PATH = "artifacts/visitecrm/src/components/layout.tsx";
const WORKFLOW_SOURCE_PATH = ".github/workflows/ci.yml";

function normalizeBaseUrl(configuredUrl) {
  if (!configuredUrl?.trim()) {
    throw new Error(
      "PUBLICATION_CHUNK_URL is not configured; set it to the published storefront URL before checking JavaScript chunks.",
    );
  }

  const url = new URL(configuredUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("PUBLICATION_CHUNK_URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assertLoopbackBaseUrl(baseUrl) {
  const hostname = baseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error(
      `Local built-chunk verification is restricted to loopback URLs (localhost, 127.0.0.1, or ::1); received ${baseUrl.origin}.`,
    );
  }
}

function normalizePath(pathname, variableName) {
  if (!pathname?.trim() || !pathname.startsWith("/")) {
    throw new Error(`${variableName} must be an absolute path starting with "/".`);
  }
  return pathname;
}

function uniquePaths(paths) {
  return [...new Set(paths)].filter(Boolean);
}

function extractProtectedRouteEntries(source, { menu = false } = {}) {
  const pattern = menu
    ? /\bhref\s*:\s*["']([^"']+)["']/g
    : /<Route\b[\s\S]*?\/>/g;
  const entries = [];

  for (const match of source.matchAll(pattern)) {
    const text = match[0];
    const path = menu
      ? match[1]
      : text.match(/\bpath\s*=\s*["']([^"']+)["']/)?.[1];
    if (!path || (!menu && !text.includes("RoleGate"))) continue;
    const startLine = source.slice(0, match.index).split("\n").length;
    const endLine = startLine + text.split("\n").length - 1;
    entries.push({ path, startLine, endLine });
  }

  return entries;
}

export function getProtectedPublicationRoutes({
  routerSource,
  navigationSource,
}) {
  return uniquePaths([
    ...extractProtectedRouteEntries(routerSource),
    ...extractProtectedRouteEntries(navigationSource, { menu: true }),
  ].map(({ path }) => path));
}

function getAddedLineNumbers(diff) {
  const addedLines = [];
  let nextLine;

  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (nextLine === undefined) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push(nextLine);
      nextLine += 1;
    } else if (!line.startsWith("-")) {
      nextLine += 1;
    }
  }

  return addedLines;
}

function getChangedPaths(source, diff, options) {
  const addedLines = new Set(getAddedLineNumbers(diff));
  return extractProtectedRouteEntries(source, options)
    .filter(({ startLine, endLine }) => {
      for (let line = startLine; line <= endLine; line += 1) {
        if (addedLines.has(line)) return true;
      }
      return false;
    })
    .map(({ path }) => path);
}

export function getChangedProtectedPublicationRoutes({
  routerSource,
  navigationSource,
  routerDiff = "",
  navigationDiff = "",
}) {
  return uniquePaths([
    ...getChangedPaths(routerSource, routerDiff),
    ...getChangedPaths(navigationSource, navigationDiff, { menu: true }),
  ]);
}

export function getWorkflowPublicationPaths(workflowSource) {
  const paths = [];
  const pathEnvironmentPattern =
    /^\s*(PUBLICATION_CHUNK_[A-Z0-9_]*PATHS):\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/;

  for (const line of workflowSource.split("\n")) {
    const match = line.match(pathEnvironmentPattern);
    if (!match) continue;
    paths.push(
      ...match[2]
        .split(",")
        .map((path) => path.trim())
        .filter(Boolean),
    );
  }

  return uniquePaths(paths);
}

export function assertProtectedPublicationRouteCoverage({
  routerSource,
  navigationSource,
  routerDiff,
  navigationDiff,
  workflowSource,
}) {
  const changedRoutes = getChangedProtectedPublicationRoutes({
    routerSource,
    navigationSource,
    routerDiff,
    navigationDiff,
  });
  const configuredPaths = getWorkflowPublicationPaths(workflowSource);
  const missingRoutes = changedRoutes.filter(
    (route) => !configuredPaths.includes(route),
  );

  if (missingRoutes.length > 0) {
    throw new Error(
      [
        "Protected publication route coverage is missing for route(s):",
        ...missingRoutes.map((route) => `  - ${route}`),
        "Add each route to the appropriate PUBLICATION_CHUNK_*_PATHS list in .github/workflows/ci.yml.",
      ].join("\n"),
    );
  }

  return { changedRoutes, configuredPaths, missingRoutes };
}

function getHeadDiff(filePath) {
  try {
    return execFileSync(
      "git",
      ["diff", "--unified=0", "HEAD^", "HEAD", "--", filePath],
      { encoding: "utf8" },
    );
  } catch (error) {
    throw new Error(
      `Could not inspect the previous commit for protected route coverage (${filePath}). ` +
        "The CI checkout must include at least two commits.",
      { cause: error },
    );
  }
}

export async function checkProtectedPublicationRouteCoverage({
  routerSource,
  navigationSource,
  routerDiff,
  navigationDiff,
  workflowSource,
} = {}) {
  const [resolvedRouterSource, resolvedNavigationSource, resolvedWorkflowSource] =
    await Promise.all([
      routerSource ?? readFile(ROUTER_SOURCE_PATH, "utf8"),
      navigationSource ?? readFile(NAVIGATION_SOURCE_PATH, "utf8"),
      workflowSource ?? readFile(WORKFLOW_SOURCE_PATH, "utf8"),
    ]);

  return assertProtectedPublicationRouteCoverage({
    routerSource: resolvedRouterSource,
    navigationSource: resolvedNavigationSource,
    routerDiff: routerDiff ?? getHeadDiff(ROUTER_SOURCE_PATH),
    navigationDiff: navigationDiff ?? getHeadDiff(NAVIGATION_SOURCE_PATH),
    workflowSource: resolvedWorkflowSource,
  });
}

function getTimeoutMs() {
  const configuredTimeout = Number(process.env["PUBLICATION_CHUNK_TIMEOUT_MS"]);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;
}

async function callClerkBackend({
  secretKey,
  path,
  body,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL(path, CLERK_BACKEND_API_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(getTimeoutMs()),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function getClerkErrorDetail(payload, secretKey) {
  const details = Array.isArray(payload?.errors)
    ? payload.errors
        .flatMap((error) => [error?.code, error?.long_message, error?.message])
        .filter((value) => typeof value === "string" && value.trim())
    : [];
  const detail = details.join(": ").slice(0, 300);
  return secretKey
    ? detail.replaceAll(secretKey, "[redacted]") ||
        "Clerk returned no error details"
    : detail || "Clerk returned no error details";
}

export async function createPublicationSignInProfiles({
  publicUrl,
  secretKey,
  environment = process.env,
  fetchImpl = fetch,
  onProfileCreated,
} = {}) {
  const clerkSecretKey = (secretKey ?? environment["CLERK_SECRET_KEY"])?.trim();
  if (!clerkSecretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is missing; configure the GitHub Actions secret for the Clerk instance used by the published site.",
    );
  }
  const baseUrl = normalizeBaseUrl(
    publicUrl ??
      environment["PUBLICATION_CHUNK_URL"] ??
      environment["PUBLICATION_SMOKE_URL"],
  );
  const redirectUrl = new URL(DEFAULT_PUBLIC_PATH, baseUrl).href;
  const profiles = [];

  for (const profileEnvironment of PROFILE_ENVIRONMENTS) {
    const userId = environment[
      profileEnvironment.userIdEnvironmentVariable
    ]?.trim();
    if (!userId) {
      throw new Error(
        `The ${profileEnvironment.label} Clerk account is not configured; set the GitHub Actions variable ${profileEnvironment.userIdEnvironmentVariable} to its user ID.`,
      );
    }

    let response;
    let payload;
    try {
      ({ response, payload } = await callClerkBackend({
        secretKey: clerkSecretKey,
        path: "sign_in_tokens",
        body: {
          user_id: userId,
          expires_in_seconds: CLERK_SIGN_IN_TOKEN_TTL_SECONDS,
        },
        fetchImpl,
      }));
    } catch {
      throw new Error(
        `Could not reach Clerk while creating the ${profileEnvironment.label} publication sign-in token.`,
      );
    }
    if (!response.ok) {
      const hint =
        response.status === 401
          ? "Check that the CLERK_SECRET_KEY GitHub Actions secret belongs to the published Clerk instance."
          : response.status === 404
            ? `Check the user ID in ${profileEnvironment.userIdEnvironmentVariable}.`
            : getClerkErrorDetail(payload, clerkSecretKey);
      throw new Error(
        `Clerk could not create the ${profileEnvironment.label} publication sign-in token (HTTP ${response.status}). ${hint}`,
      );
    }
    if (typeof payload?.id !== "string" || typeof payload?.url !== "string") {
      throw new Error(
        `Clerk returned an incomplete sign-in token for the ${profileEnvironment.label} profile; verify the Backend API response and Clerk instance configuration.`,
      );
    }

    let signInUrl;
    try {
      signInUrl = new URL(payload.url);
    } catch {
      throw new Error(
        `Clerk returned an invalid sign-in URL for the ${profileEnvironment.label} profile.`,
      );
    }
    if (signInUrl.protocol !== "https:") {
      throw new Error(
        `Clerk returned a non-HTTPS sign-in URL for the ${profileEnvironment.label} profile.`,
      );
    }
    signInUrl.searchParams.set("redirect_url", redirectUrl);

    const profile = {
      name: profileEnvironment.name,
      label: profileEnvironment.label,
      paths: getConfiguredProfilePaths(profileEnvironment, environment),
      signInUrl: signInUrl.href,
      expectedUserId: userId,
      signInTokenId: payload.id,
    };
    profiles.push(profile);
    await onProfileCreated?.(profile);
  }

  return profiles;
}

async function revokeClerkResource({
  secretKey,
  path,
  profileName,
  resourceLabel,
  fetchImpl,
}) {
  try {
    const { response, payload } = await callClerkBackend({
      secretKey,
      path,
      fetchImpl,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      return `Could not revoke the temporary ${resourceLabel} for the ${profileName} profile (HTTP ${response.status}): ${getClerkErrorDetail(payload, secretKey)}.`;
    }
    return null;
  } catch {
    return `Could not reach Clerk to revoke the temporary ${resourceLabel} for the ${profileName} profile.`;
  }
}

export async function cleanupPublicationClerkSessions({
  profiles,
  sessionIds,
  secretKey,
  fetchImpl = fetch,
} = {}) {
  const failures = [];
  for (const profile of profiles ?? []) {
    const sessionId = sessionIds?.get(profile.name);
    const failure = sessionId
      ? await revokeClerkResource({
          secretKey,
          path: `sessions/${encodeURIComponent(sessionId)}/revoke`,
          profileName: profile.label ?? profile.name,
          resourceLabel: "session",
          fetchImpl,
        })
      : profile.signInTokenId
        ? await revokeClerkResource({
            secretKey,
            path: `sign_in_tokens/${encodeURIComponent(profile.signInTokenId)}/revoke`,
            profileName: profile.label ?? profile.name,
            resourceLabel: "sign-in token",
            fetchImpl,
          })
        : null;
    if (failure) failures.push(failure);
  }
  return failures;
}

function getProtectedPaths(configuredPaths, fallbackPath = DEFAULT_PROTECTED_PATH) {
  const configured =
    configuredPaths ??
    process.env["PUBLICATION_CHUNK_PROTECTED_PATHS"]
      ?.split(",")
      .map((path) => path.trim())
      .filter(Boolean);
  const paths = configured?.length
    ? configured
    : fallbackPath === DEFAULT_PROTECTED_PATH
      ? DEFAULT_PROTECTED_PATHS
      : [fallbackPath];
  return [...new Set(paths)].map((path) =>
    normalizePath(path, "PUBLICATION_CHUNK_PROTECTED_PATHS"),
  );
}

function getConfiguredProfilePaths(profileEnvironment, environment = process.env) {
  const configured = environment[profileEnvironment.pathEnvironmentVariable]
    ?.split(",")
    .map((path) => path.trim())
    .filter(Boolean);
  const paths = configured?.length ? configured : [profileEnvironment.defaultPath];
  return [...new Set(paths)].map((path) =>
    normalizePath(path, profileEnvironment.pathEnvironmentVariable),
  );
}

function assertProtectedHeaders(headers, profileName = null) {
  if (headers.Authorization || headers.Cookie) return;
  const profileDescription = profileName
    ? ` for the protected ${profileName} profile`
    : "";
  throw new Error(
    `The protected chunk ${
      profileName ? "routes" : "route"
    }${profileDescription} requires an authenticated session; provide a generated Clerk sign-in profile or explicit test headers.`,
  );
}

function getProtectedSessionFailure({
  profileName,
  route,
  status,
  finalUrl,
}) {
  if (!profileName) return null;
  const profileEnvironment = PROFILE_ENVIRONMENTS.find(
    (profile) => profile.name === profileName,
  );
  const profileDescription = profileEnvironment
    ? profileEnvironment.label
    : profileName;
  const statusDescription = status
    ? `HTTP ${status}`
    : "an authentication redirect";
  const destination = finalUrl ? ` to ${finalUrl.pathname}` : "";
  const userIdVariable = profileEnvironment?.userIdEnvironmentVariable;
  const identityHint = userIdVariable
    ? ` Verify CLERK_SECRET_KEY and the account/role configured by ${userIdVariable}.`
    : " Verify the configured Clerk test session.";
  return `${route}: ${profileDescription} Clerk session was rejected (${statusDescription})${destination}.${identityHint}`;
}

function isAuthenticationRedirect(routeUrl, finalUrl) {
  if (routeUrl.pathname === finalUrl.pathname) return false;
  return /(?:^|\/)(?:sign-in|signin|login|entrar)(?:\/|$)/i.test(
    finalUrl.pathname,
  );
}

function normalizeProtectedProfile(profile, index) {
  if (!profile || typeof profile !== "object") {
    throw new Error(`Protected chunk profile ${index + 1} must be an object.`);
  }
  const name =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : `profile-${index + 1}`;
  const configuredPaths =
    profile.protectedPaths ?? profile.paths ?? (profile.path ? [profile.path] : undefined);
  const paths = configuredPaths?.length
    ? [...new Set(configuredPaths)].map((path) =>
        normalizePath(path, `protectedProfiles[${index}].paths`),
      )
    : [DEFAULT_PROTECTED_PATH];
  const headers = {
    "User-Agent": USER_AGENT,
    ...(profile.protectedHeaders ?? profile.headers ?? {}),
  };
  const signInUrl =
    typeof profile.signInUrl === "string" && profile.signInUrl.trim()
      ? profile.signInUrl.trim()
      : undefined;
  if (!signInUrl) {
    assertProtectedHeaders(headers, name);
  } else {
    let parsedSignInUrl;
    try {
      parsedSignInUrl = new URL(signInUrl);
    } catch {
      throw new Error(`Protected chunk profile ${name} has an invalid Clerk sign-in URL.`);
    }
    if (parsedSignInUrl.protocol !== "https:") {
      throw new Error(`Protected chunk profile ${name} sign-in URL must use HTTPS.`);
    }
  }
  return {
    name,
    label: profile.label ?? name,
    paths,
    headers,
    signInUrl,
    expectedUserId: profile.expectedUserId,
    signInTokenId: profile.signInTokenId,
  };
}

function getProtectedProfiles({ configuredProfiles, protectedHeaders, protectedPath }) {
  if (configuredProfiles !== undefined) {
    if (!Array.isArray(configuredProfiles)) {
      throw new Error("protectedProfiles must be an array.");
    }
    return configuredProfiles.map(normalizeProtectedProfile);
  }

  const headers = {
    "User-Agent": USER_AGENT,
    ...protectedHeaders,
  };
  assertProtectedHeaders(headers);
  return [
    {
      name: "protected",
      paths: [normalizePath(protectedPath, "PUBLICATION_CHUNK_PROTECTED_PATH")],
      headers,
    },
  ];
}

function getInteractionSelectors(configuredSelectors) {
  const configured =
    configuredSelectors ??
    process.env["PUBLICATION_CHUNK_INTERACTION_SELECTORS"]
      ?.split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
  return configured?.length ? [...new Set(configured)] : DEFAULT_INTERACTION_SELECTORS;
}

function getScriptReferences(body) {
  const references = new Set();
  const scriptPattern = /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi;
  for (const match of body.matchAll(scriptPattern)) {
    references.add(match[1]);
  }
  return [...references];
}

function getJavaScriptReferences(body) {
  const references = new Set();
  const dynamicImportPattern =
    /import\s*\(\s*["'`]([^"'`\\\r\n]+\.js(?:\?[^"'`\\\r\n]*)?)["'`]\s*\)/g;
  for (const match of body.matchAll(dynamicImportPattern)) {
    references.add(match[1]);
  }
  const viteChunkReferencePattern =
    /["'`](assets\/[^"'`\\\r\n]+\.js(?:\?[^"'`\\\r\n]*)?)["'`]/g;
  for (const match of body.matchAll(viteChunkReferencePattern)) {
    references.add(match[1]);
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

async function fetchText(url, headers, timeoutMs, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    response,
    finalUrl: new URL(response.url || url.href),
    body: await response.text(),
  };
}

function describeResponse(response, finalUrl) {
  const contentType = response.headers?.get?.("content-type") ?? "missing";
  return `HTTP ${response.status} from ${finalUrl} (content-type: ${contentType})`;
}

function isJavaScriptContentType(contentType) {
  return /^(?:application|text)\/(?:java|ecma)script(?:\s*;|$)/i.test(
    contentType.trim(),
  );
}

function isJavaScriptAssetUrl(value) {
  try {
    return new URL(value).pathname.endsWith(".js");
  } catch {
    return false;
  }
}

function validateObservedAsset({ route, asset, expectedOrigin }) {
  const failures = [];
  let assetUrl;
  try {
    assetUrl = new URL(asset.url);
  } catch {
    failures.push(`${route}: JavaScript asset ${asset.url} has an invalid URL`);
    return failures;
  }

  if (assetUrl.origin !== expectedOrigin) {
    failures.push(
      `${route}: JavaScript asset ${asset.url} resolved to unexpected origin ${assetUrl.origin}`,
    );
  }
  if (asset.status < 200 || asset.status >= 300) {
    failures.push(
      `${route}: JavaScript asset ${asset.url} failed: HTTP ${asset.status} (content-type: ${asset.contentType || "missing"})`,
    );
  } else if (!isJavaScriptContentType(asset.contentType ?? "")) {
    failures.push(
      `${route}: JavaScript asset ${asset.url} failed: HTTP ${asset.status} (content-type: ${asset.contentType || "missing"})`,
    );
  }
  return failures;
}

async function crawlRoute({
  route,
  profileName,
  url,
  headers,
  expectedOrigin,
  timeoutMs,
  fetchImpl,
}) {
  const failures = [];
  const checkedAssets = [];
  const pending = [];
  const visited = new Set();

  try {
    const documentResult = await fetchText(url, headers, timeoutMs, fetchImpl);
    if (documentResult.finalUrl.origin !== expectedOrigin) {
      failures.push(
        `${route}: document redirected to unexpected origin ${documentResult.finalUrl.origin}`,
      );
    }
    if (documentResult.response.status !== 200) {
      failures.push(
        getProtectedSessionFailure({
          profileName,
          route,
          status: documentResult.response.status,
          finalUrl: documentResult.finalUrl,
        }) ??
          `${route}: document ${documentResult.finalUrl} returned ${describeResponse(
            documentResult.response,
            documentResult.finalUrl,
          )}`,
      );
    } else if (isAuthenticationRedirect(url, documentResult.finalUrl)) {
      failures.push(
        getProtectedSessionFailure({
          profileName,
          route,
          finalUrl: documentResult.finalUrl,
        }) ??
          `${route}: document redirected to ${documentResult.finalUrl.pathname}`,
      );
    } else {
      for (const reference of getScriptReferences(documentResult.body)) {
        const assetUrl = resolveSameOriginAsset(
          reference,
          documentResult.finalUrl,
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
    checkedAssets.push(assetUrl.href);

    try {
      const assetResult = await fetchText(assetUrl, headers, timeoutMs, fetchImpl);
      const contentType = assetResult.response.headers?.get?.("content-type") ?? "";
      if (
        assetResult.finalUrl.origin !== expectedOrigin ||
        assetResult.response.status < 200 ||
        assetResult.response.status >= 300 ||
        !isJavaScriptContentType(contentType)
      ) {
        failures.push(
          `${route}: JavaScript asset ${assetUrl} failed: ${describeResponse(
            assetResult.response,
            assetResult.finalUrl,
          )}`,
        );
        continue;
      }

      for (const reference of getJavaScriptReferences(assetResult.body)) {
        const childUrl = resolveSameOriginAsset(
          reference,
          assetResult.finalUrl,
          expectedOrigin,
        );
        if (childUrl && !visited.has(childUrl.href)) pending.push(childUrl);
      }
    } catch (error) {
      failures.push(
        `${route}: JavaScript asset ${assetUrl} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    route,
    ...(profileName ? { profile: profileName } : {}),
    ok: failures.length === 0,
    assets: checkedAssets,
    failures,
  };
}

function waitForOutput(process, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("Timed out while starting the headless browser."));
    }, timeoutMs);
    process.stderr.setEncoding("utf8");
    process.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(pattern);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once("exit", (code, signal) => {
      if (code !== null || signal !== null) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Headless browser exited before startup (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
          ),
        );
      }
    });
  });
}

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Timed out reading browser endpoint.")));
    request.on("error", reject);
  });
}

class DevToolsClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      const listeners = this.#listeners.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("Headless browser connection closed."));
      }
      this.#pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? [];
    listeners.push(listener);
    this.#listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPageTarget({
  getTargets,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = 100,
  now = Date.now,
  sleepImpl = wait,
} = {}) {
  const deadline = now() + timeoutMs;

  while (true) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;

    const targets = await getTargets(remainingMs);
    const pageTarget = targets.find(
      (target) => target.type === "page" && target.webSocketDebuggerUrl,
    );
    if (pageTarget) return pageTarget;

    const remainingAfterLookupMs = deadline - now();
    if (remainingAfterLookupMs <= 0) break;
    await sleepImpl(Math.min(pollIntervalMs, remainingAfterLookupMs));
  }

  throw new Error("Headless browser did not expose a page target.");
}

async function stopBrowserProcess(browserProcess) {
  if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
    await new Promise((resolve) => {
      const finish = () => resolve();
      browserProcess.once("exit", finish);
      browserProcess.kill("SIGTERM");
      setTimeout(() => {
        if (browserProcess.exitCode === null && browserProcess.signalCode === null) {
          browserProcess.kill("SIGKILL");
        }
        resolve();
      }, 2_000);
    });
  }
}

function findChromium() {
  const configured = process.env["CHROMIUM_PATH"]?.trim();
  if (configured) return configured;
  for (const candidate of [
    "/repl/tools/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "chromium";
}

async function launchChromium({ headers, timeoutMs }) {
  const profileDirectory = await mkdtemp(`${tmpdir()}/publication-chunks-`);
  const browserProcess = spawn(
    findChromium(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  try {
    const port = await waitForOutput(browserProcess, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, timeoutMs);
    const page = await waitForPageTarget({
      getTargets: (remainingMs) =>
        getJson(`http://127.0.0.1:${port}/json/list`, remainingMs),
      timeoutMs,
    });
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const client = new DevToolsClient(socket);
    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Runtime.enable");
    return {
      client,
      process: browserProcess,
      profileDirectory,
    };
  } catch (error) {
    await stopBrowserProcess(browserProcess);
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    throw error;
  }
}

async function runBrowserSmoke({
  baseUrl,
  profileName,
  profileLabel,
  protectedPaths,
  headers,
  signInUrl,
  expectedUserId,
  onSessionCreated,
  expectedOrigin,
  timeoutMs,
  interactionSelectors,
  browserFactory = launchChromium,
}) {
  const browser = await browserFactory({ headers, timeoutMs, profileName });
  const { client } = browser;
  const failures = [];
  const assetsByRoute = new Map();
  const requests = new Map();
  const signInOrigin = signInUrl ? new URL(signInUrl, baseUrl).origin : null;
  const signInResponseDiagnostics = [];
  let activeRoute = null;

  function recordSignInResponse(type, response) {
    if (!signInOrigin || !response?.url) return;
    let responseUrl;
    try {
      responseUrl = new URL(response.url);
    } catch {
      return;
    }
    if (responseUrl.origin !== signInOrigin) return;
    if (type !== "Document" && response.status < 400) return;

    const status = Number.isFinite(response.status)
      ? Math.trunc(response.status)
      : "unknown";
    const diagnostic =
      `HTTP ${status} ${type ?? "unknown"} ` +
      `${responseUrl.origin}${responseUrl.pathname}`;
    if (
      signInResponseDiagnostics.length < 8 &&
      !signInResponseDiagnostics.includes(diagnostic)
    ) {
      signInResponseDiagnostics.push(diagnostic);
    }
  }

  client.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    if (type !== "Script" && !isJavaScriptAssetUrl(request.url)) return;
    const requestUrl = new URL(request.url);
    if (requestUrl.origin === expectedOrigin) {
      requests.set(requestId, { url: request.url, route: activeRoute });
    }
  });
  client.on("Network.responseReceived", ({ requestId, response, type }) => {
    recordSignInResponse(type, response);
    const requestInfo = requests.get(requestId);
    if (!requestInfo) return;
    const asset = {
      url: response.url,
      status: response.status,
      contentType: response.mimeType ?? "",
    };
    const route = requestInfo.route;
    if (!route) return;
    const assets = assetsByRoute.get(route) ?? [];
    if (!assets.some((existing) => existing.url === asset.url)) assets.push(asset);
    assetsByRoute.set(route, assets);
    failures.push(...validateObservedAsset({ route, asset, expectedOrigin }));
  });
  client.on("Network.loadingFailed", ({ requestId, errorText }) => {
    const requestInfo = requests.get(requestId);
    if (!requestInfo?.route) return;
    failures.push(
      `${requestInfo.route}: JavaScript asset ${requestInfo.url} request failed: ${errorText}`,
    );
  });
  client.on("Fetch.requestPaused", ({ requestId, request }) => {
    let requestOrigin = null;
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      // Continue malformed or browser-internal requests unchanged.
    }
    const requestHeaders =
      requestOrigin === expectedOrigin
        ? (() => {
            const merged = new Map(
              Object.entries(request.headers ?? {}).map(([name, value]) => [
                name.toLowerCase(),
                { name, value },
              ]),
            );
            for (const [name, value] of Object.entries(headers)) {
              merged.set(name.toLowerCase(), { name, value });
            }
            return [...merged.values()];
          })()
        : undefined;
    void client
      .send("Fetch.continueRequest", {
        requestId,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
      })
      .catch(() => {});
  });
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });

  async function navigate(path, route = path) {
    activeRoute = route;
    const loaded = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      client.on("Page.loadEventFired", finish);
      setTimeout(finish, Math.min(timeoutMs, 3_000));
    });
    const navigation = client.send("Page.navigate", {
      url: new URL(path, baseUrl).href,
    });
    await navigation;
    await loaded;
    await wait(250);
  }

  async function getBrowserSessionState() {
    try {
      const result = await client.send("Runtime.evaluate", {
        expression: `(() => {
          const clerk = window.Clerk;
          return {
            origin: window.location.origin,
            pathname: window.location.pathname,
            documentTitle: document.title ?? null,
            clerkPresent: Boolean(clerk),
            clerkLoaded: Boolean(clerk?.loaded),
            userId: clerk?.user?.id ?? null,
            sessionId: clerk?.session?.id ?? null,
            hasUser: Boolean(clerk?.user?.id),
            hasSession: Boolean(clerk?.session?.id),
          };
        })()`,
        returnByValue: true,
      });
      return result.result?.value ?? null;
    } catch {
      return null;
    }
  }

  async function waitForAuthenticatedSession() {
    const deadline = Date.now() + Math.max(timeoutMs, 5_000);
    let state = null;
    while (Date.now() < deadline) {
      state = await getBrowserSessionState();
      if (
        state?.origin === expectedOrigin &&
        typeof state.userId === "string" &&
        typeof state.sessionId === "string"
      ) {
        return state;
      }
      await wait(100);
    }
    const lastLocation =
      state?.origin && state?.pathname
        ? `${state.origin}${state.pathname}`
        : "no application page";
    const safeTitle =
      typeof state?.documentTitle === "string"
        ? state.documentTitle
            .replace(/[\r\n\t]+/g, " ")
            .replace(
              /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
              "[redacted email]",
            )
            .slice(0, 120)
        : "unavailable";
    const clerkState = state
      ? `Clerk=${state.clerkPresent ? (state.clerkLoaded ? "loaded" : "present/not-loaded") : "absent"}, user=${state.hasUser ? "present" : "absent"}, session=${state.hasSession ? "present" : "absent"}`
      : "browser state unavailable";
    const portalResponses = signInResponseDiagnostics.length
      ? signInResponseDiagnostics.join("; ")
      : "none captured";
    throw new Error(
      `Clerk did not activate the ${profileLabel ?? profileName} CI session on the published site (last page: ${lastLocation}; title=${JSON.stringify(safeTitle)}; ${clerkState}; Account Portal responses: ${portalResponses}).`,
    );
  }

  async function validateRouteSession(route, activeSession) {
    if (!signInUrl) return;
    const state = await getBrowserSessionState();
    let finalUrl;
    try {
      if (state?.origin && state?.pathname) {
        finalUrl = new URL(state.pathname, state.origin);
      }
    } catch {
      // Report an unavailable session below without exposing browser internals.
    }
    const requestedUrl = new URL(route, baseUrl);
    const normalizedPath = (pathname) => pathname.replace(/\/+$/, "") || "/";
    const wasRedirected =
      !finalUrl ||
      finalUrl.origin !== expectedOrigin ||
      normalizedPath(finalUrl.pathname) !== normalizedPath(requestedUrl.pathname);
    const identityChanged =
      !state?.sessionId ||
      state.sessionId !== activeSession.sessionId ||
      state.userId !== expectedUserId;
    if (!wasRedirected && !identityChanged) return;

    if (finalUrl && isAuthenticationRedirect(requestedUrl, finalUrl)) {
      failures.push(
        getProtectedSessionFailure({
          profileName,
          route,
          finalUrl,
        }),
      );
      return;
    }
    const profileEnvironment = PROFILE_ENVIRONMENTS.find(
      (profile) => profile.name === profileName,
    );
    const identityVariable = profileEnvironment?.userIdEnvironmentVariable;
    failures.push(
      `${route}: the ${profileLabel ?? profileName} Clerk account did not remain active on this route.${identityVariable ? ` Verify ${identityVariable} and that the account has the expected application role.` : ""}`,
    );
  }

  async function clickInteractions(path) {
    for (const selector of interactionSelectors) {
      let count;
      try {
        const result = await client.send("Runtime.evaluate", {
          expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
          returnByValue: true,
        });
        count = Math.min(Number(result.result?.value) || 0, 12);
      } catch {
        continue;
      }
      for (let index = 0; index < count; index += 1) {
        try {
          await client.send("Runtime.evaluate", {
            expression: `(() => { const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!element) return false; element.click(); return true; })()`,
            returnByValue: true,
          });
          await wait(Math.min(timeoutMs, 750));
        } catch {
          // A route can unmount an interaction while it is being clicked. The
          // route navigation itself is still useful and remains validated.
        }
        await navigate(path);
        await validateRouteSession(path, authenticatedSession);
      }
    }
  }

  let authenticatedSession = null;
  try {
    if (signInUrl) {
      await navigate(signInUrl, null);
      authenticatedSession = await waitForAuthenticatedSession();
      await onSessionCreated?.({
        profileName,
        sessionId: authenticatedSession.sessionId,
      });
      if (expectedUserId && authenticatedSession.userId !== expectedUserId) {
        const profileEnvironment = PROFILE_ENVIRONMENTS.find(
          (profile) => profile.name === profileName,
        );
        throw new Error(
          `The Clerk sign-in token authenticated a different account for the ${profileLabel ?? profileName} profile. Check ${profileEnvironment?.userIdEnvironmentVariable ?? "its configured user ID"}.`,
        );
      }
    }
    for (const path of protectedPaths) {
      await navigate(path);
      await validateRouteSession(path, authenticatedSession);
      await clickInteractions(path);
    }
  } finally {
    client.close();
    await stopBrowserProcess(browser.process);
    await rm(browser.profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }

  return protectedPaths.map((route) => {
    const routeFailures = failures.filter((failure) => failure.startsWith(`${route}:`));
    const assets = assetsByRoute.get(route) ?? [];
    return {
      route,
      profile: profileName,
      ok: routeFailures.length === 0 && assets.length > 0,
      assets: assets.map((asset) => asset.url),
      failures:
        assets.length > 0
          ? routeFailures
          : [`${route}: browser did not observe any JavaScript assets`],
    };
  });
}

export async function verifyPublishedInteractions({
  publicUrl,
  protectedPath = DEFAULT_PROTECTED_PATH,
  protectedPaths,
  protectedHeaders,
  protectedProfiles,
  onSessionCreated,
  timeoutMs = getTimeoutMs(),
  interactionSelectors,
  browserFactory,
} = {}) {
  const baseUrl = normalizeBaseUrl(
    publicUrl ??
      process.env["PUBLICATION_CHUNK_URL"] ??
      process.env["PUBLICATION_SMOKE_URL"],
  );
  const configuredProfiles =
    protectedProfiles ??
    (protectedPaths
      ? [
          {
            name: "protected",
            protectedPaths,
            protectedHeaders,
          },
        ]
      : undefined);
  const profiles = getProtectedProfiles({
    configuredProfiles,
    protectedHeaders,
    protectedPath,
  });
  const results = [];
  for (const profile of profiles) {
    results.push(
      ...(await runBrowserSmoke({
        baseUrl,
        profileName: profile.name,
        profileLabel: profile.label,
        protectedPaths: profile.paths,
        headers: profile.headers,
        signInUrl: profile.signInUrl,
        expectedUserId: profile.expectedUserId,
        onSessionCreated,
        expectedOrigin: baseUrl.origin,
        timeoutMs,
        interactionSelectors: getInteractionSelectors(interactionSelectors),
        browserFactory,
      })),
    );
  }
  return results;
}

export async function verifyPublishedChunks({
  publicUrl,
  publicPath = DEFAULT_PUBLIC_PATH,
  protectedPath = DEFAULT_PROTECTED_PATH,
  protectedHeaders,
  protectedProfiles,
  timeoutMs = getTimeoutMs(),
  fetchImpl = fetch,
} = {}) {
  const baseUrl = normalizeBaseUrl(
    publicUrl ??
      process.env["PUBLICATION_CHUNK_URL"] ??
      process.env["PUBLICATION_SMOKE_URL"],
  );
  const normalizedPublicPath = normalizePath(
    publicPath,
    "PUBLICATION_CHUNK_PUBLIC_PATH",
  );
  const normalizedProtectedPath = normalizePath(
    protectedPath,
    "PUBLICATION_CHUNK_PROTECTED_PATH",
  );
  const publicHeaders = { "User-Agent": USER_AGENT };
  const configuredProfiles =
    protectedProfiles ??
    (protectedPath !== DEFAULT_PROTECTED_PATH
      ? [
          {
            name: "protected",
            protectedPaths: [protectedPath],
            protectedHeaders,
          },
        ]
      : undefined);
  const profiles = getProtectedProfiles({
    configuredProfiles,
    protectedHeaders,
    protectedPath,
  });

  const expectedOrigin = baseUrl.origin;
  const routes = [
    {
      route: normalizedPublicPath,
      headers: publicHeaders,
    },
    ...profiles.flatMap((profile) =>
      profile.paths.map((route) => ({
        route,
        profile: profile.name,
        headers: profile.headers,
      })),
    ),
  ];

  return Promise.all(
    routes.map(({ route, profile, headers }) =>
      crawlRoute({
        route,
        url: new URL(route, baseUrl),
        headers,
        profileName: profile,
        expectedOrigin,
        timeoutMs,
        fetchImpl,
      }),
    ),
  );
}

export async function verifyLocalBuiltChunks({
  publicUrl,
  publicPath = DEFAULT_PUBLIC_PATH,
  environment = process.env,
  timeoutMs = getTimeoutMs(),
  fetchImpl = fetch,
} = {}) {
  const baseUrl = normalizeBaseUrl(
    publicUrl ?? environment["PUBLICATION_CHUNK_URL"],
  );
  assertLoopbackBaseUrl(baseUrl);

  const protectedRoutes = PROFILE_ENVIRONMENTS.flatMap((profile) => {
    const configuredPaths = environment[profile.pathEnvironmentVariable]?.trim();
    if (!configuredPaths) {
      throw new Error(
        `${profile.pathEnvironmentVariable} must be configured for local built-chunk verification.`,
      );
    }
    return getConfiguredProfilePaths(profile, environment).map((route) => ({
      route,
      profile: profile.name,
    }));
  });
  const routes = [
    { route: normalizePath(publicPath, "PUBLICATION_CHUNK_PUBLIC_PATH") },
    ...protectedRoutes,
  ];
  const headers = { "User-Agent": USER_AGENT };
  const localFetchImpl = (input, init = {}) =>
    fetchImpl(input, { ...init, redirect: "manual" });

  return Promise.all(
    routes.map(async ({ route, profile }) => {
      const result = await crawlRoute({
        route,
        url: new URL(route, baseUrl),
        headers,
        expectedOrigin: baseUrl.origin,
        timeoutMs,
        fetchImpl: localFetchImpl,
      });
      return profile ? { ...result, profile } : result;
    }),
  );
}

async function main() {
  if (process.argv.includes("--check-route-coverage")) {
    const coverage = await checkProtectedPublicationRouteCoverage();
    console.log(
      `[publication-chunks] route coverage OK: checked ${coverage.changedRoutes.length} protected route change(s) against ${coverage.configuredPaths.length} configured path(s)`,
    );
    return;
  }

  if (process.argv.includes("--verify-local-build-chunks")) {
    const results = await verifyLocalBuiltChunks();
    let failed = false;
    for (const result of results) {
      const profileSuffix = result.profile ? ` [${result.profile}]` : "";
      console.log(
        `[publication-chunks] ${result.ok ? "PASS" : "FAIL"} ${result.route}${profileSuffix}: checked ${result.assets.length} JavaScript asset(s)`,
      );
      for (const failure of result.failures) {
        console.error(`[publication-chunks] ${failure}`);
        failed = true;
      }
    }
    if (failed) {
      throw new Error(
        "Local built JavaScript chunk verification failed. Each route must load every same-origin JavaScript asset with a successful JavaScript content type.",
      );
    }
    return;
  }

  const results = await verifyPublishedChunks({ protectedProfiles: [] });
  const createdProfiles = [];
  const sessionIds = new Map();
  let browserResults = [];
  let authenticationError = null;
  try {
    await createPublicationSignInProfiles({
      onProfileCreated: (profile) => createdProfiles.push(profile),
    });
    browserResults = await verifyPublishedInteractions({
      protectedProfiles: createdProfiles,
      onSessionCreated: ({ profileName, sessionId }) => {
        sessionIds.set(profileName, sessionId);
      },
    });
  } catch (error) {
    authenticationError = error;
  }

  const cleanupFailures = await cleanupPublicationClerkSessions({
    profiles: createdProfiles,
    sessionIds,
    secretKey: process.env["CLERK_SECRET_KEY"]?.trim(),
  });
  for (const failure of cleanupFailures) {
    console.error(`[publication-chunks] ERROR ${failure}`);
  }
  if (authenticationError) throw authenticationError;

  let failed = cleanupFailures.length > 0;
  for (const result of [...results, ...browserResults]) {
    const prefix = result.ok ? "PASS" : "FAIL";
    const profileSuffix = result.profile ? ` [${result.profile}]` : "";
    console.log(
      `[publication-chunks] ${prefix} ${result.route}${profileSuffix}: checked ${result.assets.length} JavaScript asset(s)`,
    );
    for (const failure of result.failures) {
      console.error(`[publication-chunks] ${failure}`);
      failed = true;
    }
  }
  if (failed) {
    throw new Error(
      cleanupFailures.length > 0
        ? "Published chunk verification failed or a temporary Clerk sign-in resource could not be revoked."
        : "Published JavaScript chunk verification failed. Each route must load every same-origin JavaScript asset with a successful JavaScript content type.",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `[publication-chunks] ERROR: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}