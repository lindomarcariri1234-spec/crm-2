import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { get } from "node:http";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SESSION_RENEWAL_WINDOW_HOURS = 72;
const DEFAULT_PUBLIC_PATH = "/";
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
    authorizationEnvironmentVariable: "PUBLICATION_CHUNK_SELLER_AUTHORIZATION",
    cookieEnvironmentVariable: "PUBLICATION_CHUNK_SELLER_COOKIE",
    expiryEnvironmentVariable: "PUBLICATION_CHUNK_SELLER_EXPIRES_AT",
    defaultPath: "/meu-painel",
  },
  {
    name: "superadmin",
    label: "superadmin",
    pathEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_PATHS",
    authorizationEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_AUTHORIZATION",
    cookieEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_COOKIE",
    expiryEnvironmentVariable: "PUBLICATION_CHUNK_SUPERADMIN_EXPIRES_AT",
    defaultPath: "/admin",
  },
  {
    name: "client",
    label: "cliente",
    pathEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_PATHS",
    authorizationEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_AUTHORIZATION",
    cookieEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_COOKIE",
    expiryEnvironmentVariable: "PUBLICATION_CHUNK_CLIENT_EXPIRES_AT",
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

function getSessionRenewalWindowHours() {
  const configuredWindow = Number(
    process.env["PUBLICATION_CHUNK_SESSION_RENEWAL_WINDOW_HOURS"],
  );
  return Number.isFinite(configuredWindow) && configuredWindow > 0
    ? configuredWindow
    : DEFAULT_SESSION_RENEWAL_WINDOW_HOURS;
}

function getProfileSessionRenewalInstructions(profileEnvironment) {
  const profileName = profileEnvironment.name.toUpperCase();
  return [
    `Renew the ${profileEnvironment.label} session by signing in again with its dedicated Clerk account`,
    `and update PUBLICATION_CHUNK_${profileName}_AUTHORIZATION or PUBLICATION_CHUNK_${profileName}_COOKIE`,
    `in GitHub Actions secrets; then update the PUBLICATION_CHUNK_${profileName}_EXPIRES_AT Actions variable`,
    "and run the CI workflow manually.",
  ].join(" ");
}

function validateProfileSessionExpiry(profileEnvironment) {
  const configuredExpiry = process.env[
    profileEnvironment.expiryEnvironmentVariable
  ]?.trim();
  if (!configuredExpiry) return;

  const expiryTime = Date.parse(configuredExpiry);
  if (!Number.isFinite(expiryTime)) {
    throw new Error(
      `The ${profileEnvironment.label} publication session expiry metadata in ${profileEnvironment.expiryEnvironmentVariable} is invalid; use an ISO-8601 timestamp. ${getProfileSessionRenewalInstructions(profileEnvironment)}`,
    );
  }

  const expiresAt = new Date(expiryTime);
  const remainingMs = expiryTime - Date.now();
  const renewalWindowMs =
    getSessionRenewalWindowHours() * 60 * 60 * 1_000;
  if (remainingMs <= 0) {
    throw new Error(
      `The ${profileEnvironment.label} publication session expired at ${expiresAt.toISOString()}. ${getProfileSessionRenewalInstructions(profileEnvironment)}`,
    );
  }
  if (remainingMs <= renewalWindowMs) {
    const remainingHours = Math.max(
      0.1,
      Math.round((remainingMs / (60 * 60 * 1_000)) * 10) / 10,
    );
    throw new Error(
      `The ${profileEnvironment.label} publication session expires in ${remainingHours} hour(s) at ${expiresAt.toISOString()}, inside the ${getSessionRenewalWindowHours()}-hour renewal window. ${getProfileSessionRenewalInstructions(profileEnvironment)}`,
    );
  }
}

function getHeadersFromEnvironment() {
  const headers = { "User-Agent": USER_AGENT };
  const authorization = process.env["PUBLICATION_CHUNK_AUTHORIZATION"]?.trim();
  const cookie = process.env["PUBLICATION_CHUNK_COOKIE"]?.trim();
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function getProfileHeadersFromEnvironment(profileEnvironment) {
  const headers = { "User-Agent": USER_AGENT };
  const authorization =
    process.env[profileEnvironment.authorizationEnvironmentVariable]?.trim();
  const cookie = process.env[profileEnvironment.cookieEnvironmentVariable]?.trim();
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function hasProfileEnvironmentConfiguration(profileEnvironment) {
  return [
    profileEnvironment.pathEnvironmentVariable,
    profileEnvironment.authorizationEnvironmentVariable,
    profileEnvironment.cookieEnvironmentVariable,
  ].some((environmentVariable) => Boolean(process.env[environmentVariable]?.trim()));
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

function getConfiguredProfilePaths(profileEnvironment) {
  const configured = process.env[profileEnvironment.pathEnvironmentVariable]
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
  const verb = profileName ? "require" : "requires";
  throw new Error(
    `The protected chunk ${
      profileName ? "routes" : "route"
    }${profileDescription} ${verb}${
      profileName
        ? ` a session via PUBLICATION_CHUNK_${profileName.toUpperCase()}_AUTHORIZATION or PUBLICATION_CHUNK_${profileName.toUpperCase()}_COOKIE`
        : " PUBLICATION_CHUNK_AUTHORIZATION or PUBLICATION_CHUNK_COOKIE"
    }; provide a short-lived test session through the environment, never in source.`,
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
  const renewalInstructions = profileEnvironment
    ? getProfileSessionRenewalInstructions(profileEnvironment)
    : `Renew the ${profileDescription} publication session and update its GitHub Actions secret.`;
  return `${route}: ${profileDescription} publication session was rejected (${statusDescription})${destination}. ${renewalInstructions}`;
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
  assertProtectedHeaders(headers, name);
  return { name, paths, headers };
}

function getProtectedProfiles({ configuredProfiles, protectedHeaders, protectedPath }) {
  if (configuredProfiles !== undefined) {
    if (!Array.isArray(configuredProfiles) || configuredProfiles.length === 0) {
      throw new Error("protectedProfiles must contain at least one profile.");
    }
    return configuredProfiles.map(normalizeProtectedProfile);
  }

  const configuredProfileEnvironments = PROFILE_ENVIRONMENTS.filter(
    hasProfileEnvironmentConfiguration,
  );
  if (configuredProfileEnvironments.length > 0) {
    return PROFILE_ENVIRONMENTS.map((profileEnvironment) => {
      const headers = getProfileHeadersFromEnvironment(profileEnvironment);
      assertProtectedHeaders(headers, profileEnvironment.label);
      validateProfileSessionExpiry(profileEnvironment);
      return {
        name: profileEnvironment.name,
        paths: getConfiguredProfilePaths(profileEnvironment),
        headers,
      };
    });
  }

  const headers = {
    ...getHeadersFromEnvironment(),
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
    const targets = await getJson(`http://127.0.0.1:${port}/json/list`, timeoutMs);
    const page = targets.find((target) => target.type === "page");
    if (!page?.webSocketDebuggerUrl) {
      throw new Error("Headless browser did not expose a page target.");
    }
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
  protectedPaths,
  headers,
  expectedOrigin,
  timeoutMs,
  interactionSelectors,
  browserFactory = launchChromium,
}) {
  const browser = await browserFactory({ headers, timeoutMs });
  const { client } = browser;
  const failures = [];
  const assetsByRoute = new Map();
  const requests = new Map();
  let activeRoute = null;

  client.on("Network.requestWillBeSent", ({ requestId, request, type }) => {
    if (type !== "Script" && !isJavaScriptAssetUrl(request.url)) return;
    const requestUrl = new URL(request.url);
    if (requestUrl.origin === expectedOrigin) {
      requests.set(requestId, { url: request.url, route: activeRoute });
    }
  });
  client.on("Network.responseReceived", ({ requestId, response, type }) => {
    const requestInfo = requests.get(requestId);
    if (!requestInfo) return;
    const asset = {
      url: response.url,
      status: response.status,
      contentType: response.mimeType ?? "",
    };
    const route = requestInfo.route ?? protectedPaths[0];
    const assets = assetsByRoute.get(route) ?? [];
    if (!assets.some((existing) => existing.url === asset.url)) assets.push(asset);
    assetsByRoute.set(route, assets);
    failures.push(...validateObservedAsset({ route, asset, expectedOrigin }));
  });
  client.on("Network.loadingFailed", ({ requestId, errorText }) => {
    const requestInfo = requests.get(requestId);
    if (!requestInfo) return;
    failures.push(
      `${requestInfo.route ?? protectedPaths[0]}: JavaScript asset ${requestInfo.url} request failed: ${errorText}`,
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

  async function navigate(path) {
    activeRoute = path;
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
      }
    }
  }

  try {
    for (const path of protectedPaths) {
      await navigate(path);
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
        protectedPaths: profile.paths,
        headers: profile.headers,
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

async function main() {
  if (process.argv.includes("--check-route-coverage")) {
    const coverage = await checkProtectedPublicationRouteCoverage();
    console.log(
      `[publication-chunks] route coverage OK: checked ${coverage.changedRoutes.length} protected route change(s) against ${coverage.configuredPaths.length} configured path(s)`,
    );
    return;
  }

  const results = await verifyPublishedChunks();
  const browserResults = await verifyPublishedInteractions();
  let failed = false;
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
      "Published JavaScript chunk verification failed. Each route must load every same-origin JavaScript asset with a successful JavaScript content type.",
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