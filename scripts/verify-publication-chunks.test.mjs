import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProtectedPublicationRouteCoverage,
  cleanupPublicationClerkSessions,
  createPublicationSignInProfiles,
  findChromium,
  getChangedProtectedPublicationRoutes,
  getProtectedPublicationRoutes,
  getWorkflowPublicationPaths,
  verifyLocalBuiltChunks,
  verifyPublishedChunks,
  verifyPublishedInteractions,
  waitForPageTarget,
} from "./verify-publication-chunks.mjs";

function response(status, body, url, contentType) {
  return {
    status,
    url,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

test("waits for Chromium's page target to appear after startup", async () => {
  let now = 0;
  let lookupCount = 0;
  const lookupTimeouts = [];
  const sleepDurations = [];
  const pageTarget = {
    type: "page",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/test",
  };

  const target = await waitForPageTarget({
    timeoutMs: 250,
    pollIntervalMs: 100,
    now: () => now,
    sleepImpl: async (durationMs) => {
      sleepDurations.push(durationMs);
      now += durationMs;
    },
    getTargets: async (remainingMs) => {
      lookupTimeouts.push(remainingMs);
      lookupCount += 1;
      return lookupCount === 1
        ? []
        : [{ type: "browser" }, pageTarget];
    },
  });

  assert.strictEqual(target, pageTarget);
  assert.deepEqual(lookupTimeouts, [250, 150]);
  assert.deepEqual(sleepDurations, [100]);
});

test("prefers runner-installed Google Chrome over snap Chromium in GitHub Actions", () => {
  const checkedCandidates = [];
  const browser = findChromium({
    environment: { GITHUB_ACTIONS: "true" },
    exists: (candidate) => {
      checkedCandidates.push(candidate);
      return (
        candidate === "/usr/bin/google-chrome" ||
        candidate === "/usr/bin/chromium"
      );
    },
  });

  assert.equal(browser, "/usr/bin/google-chrome");
  assert.deepEqual(checkedCandidates, ["/usr/bin/google-chrome"]);
});

test("respects the configured browser path before environment defaults", () => {
  assert.equal(
    findChromium({
      environment: {
        CHROMIUM_PATH: "/opt/chrome/chrome",
        GITHUB_ACTIONS: "true",
      },
      exists: () => {
        throw new Error("configured browser should bypass candidate lookup");
      },
    }),
    "/opt/chrome/chrome",
  );
});

test("fails when Chromium never exposes a page target before the timeout", async () => {
  let now = 0;
  const lookupTimeouts = [];
  const sleepDurations = [];

  await assert.rejects(
    waitForPageTarget({
      timeoutMs: 250,
      pollIntervalMs: 100,
      now: () => now,
      sleepImpl: async (durationMs) => {
        sleepDurations.push(durationMs);
        now += durationMs;
      },
      getTargets: async (remainingMs) => {
        lookupTimeouts.push(remainingMs);
        return [];
      },
    }),
    /Headless browser did not expose a page target/,
  );

  assert.deepEqual(lookupTimeouts, [250, 150, 50]);
  assert.deepEqual(sleepDurations, [100, 100, 50]);
});

test("finds protected router routes and navigation links", () => {
  const routerSource = `
    <Route path="/dashboard" component={() => <RoleGate allowedRoles="*" />} />
    <Route path="/public" component={Landing} />
  `;
  const navigationSource = `
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Trips", href: "/trips", icon: Map },
  `;

  assert.deepEqual(
    getProtectedPublicationRoutes({ routerSource, navigationSource }),
    ["/dashboard", "/trips"],
  );
});

test("identifies protected routes added in the router or menu", () => {
  const routerSource = `
    <Route path="/dashboard" component={() => <RoleGate allowedRoles="*" />} />
    <Route path="/new-area" component={() => <RoleGate allowedRoles="*" />} />
  `;
  const navigationSource = `
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "New area", href: "/new-area", icon: Map },
  `;
  const routerDiff = [
    "@@ -1,1 +2,3 @@",
    ' <Route path="/dashboard" component={() => <RoleGate allowedRoles="*" />} />',
    '+    <Route path="/new-area" component={() => <RoleGate allowedRoles="*" />} />',
  ].join("\n");
  const navigationDiff = [
    "@@ -1,1 +2,3 @@",
    ' { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },',
    '+    { name: "New area", href: "/new-area", icon: Map },',
  ].join("\n");

  assert.deepEqual(
    getChangedProtectedPublicationRoutes({
      routerSource,
      navigationSource,
      routerDiff,
      navigationDiff,
    }),
    ["/new-area"],
  );
});

test("identifies a protected menu link even without a matching router change", () => {
  const navigationSource = `
    { name: "New area", href: "/menu-only-area", icon: Map },
  `;

  assert.deepEqual(
    getChangedProtectedPublicationRoutes({
      routerSource: "",
      navigationSource,
      routerDiff: "",
      navigationDiff: "@@ -0,0 +2 @@\n+    { name: \"New area\", href: \"/menu-only-area\", icon: Map },",
    }),
    ["/menu-only-area"],
  );
});

test("requires changed protected routes to be listed in the workflow coverage", () => {
  const routerSource =
    '<Route path="/new-area" component={() => <RoleGate allowedRoles="*" />} />';
  const navigationSource = "";
  const workflowSource = `
    PUBLICATION_CHUNK_SELLER_PATHS: /meu-painel,/new-area
    PUBLICATION_CHUNK_SUPERADMIN_PATHS: /admin
    PUBLICATION_CHUNK_CLIENT_PATHS: /perfil
  `;
  const diff = "@@ -0,0 +1 @@\n+" + routerSource;

  assert.deepEqual(getWorkflowPublicationPaths(workflowSource), [
    "/meu-painel",
    "/new-area",
    "/admin",
    "/perfil",
  ]);
  assert.doesNotThrow(() =>
    assertProtectedPublicationRouteCoverage({
      routerSource,
      navigationSource,
      routerDiff: diff,
      navigationDiff: "",
      workflowSource,
    }),
  );
  assert.throws(
    () =>
      assertProtectedPublicationRouteCoverage({
        routerSource,
        navigationSource,
        routerDiff: diff,
        navigationDiff: "",
        workflowSource: "PUBLICATION_CHUNK_SELLER_PATHS: /meu-painel",
      }),
    /\/new-area/,
  );
});

test("checks JavaScript assets reached by public and authenticated routes", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.href, headers: init.headers });

    if (url.pathname === "/") {
      return response(
        200,
        '<script type="module" src="/assets/entry.js"></script>',
        url.href,
        "text/html; charset=utf-8",
      );
    }
    if (url.pathname === "/dashboard") {
      assert.equal(init.headers.Cookie, "clerk_test_session=short-lived");
      return response(
        200,
        '<script type="module" src="/assets/entry.js"></script>',
        url.href,
        "text/html; charset=utf-8",
      );
    }
    if (url.pathname === "/assets/entry.js") {
      return response(
        200,
        'import("./dashboard-lazy.js");',
        url.href,
        "application/javascript",
      );
    }
    if (url.pathname === "/assets/dashboard-lazy.js") {
      return response(200, "export default function Dashboard() {}", url.href, "application/javascript");
    }
    throw new Error(`unexpected request ${url.href}`);
  };

  const results = await verifyPublishedChunks({
    publicUrl: "https://visitecrm.com",
    protectedHeaders: { Cookie: "clerk_test_session=short-lived" },
    fetchImpl,
  });

  assert.deepEqual(
    results.map(({ route, ok, assets }) => ({ route, ok, assets })),
    [
      {
        route: "/",
        ok: true,
        assets: [
          "https://visitecrm.com/assets/entry.js",
          "https://visitecrm.com/assets/dashboard-lazy.js",
        ],
      },
      {
        route: "/dashboard",
        ok: true,
        assets: [
          "https://visitecrm.com/assets/entry.js",
          "https://visitecrm.com/assets/dashboard-lazy.js",
        ],
      },
    ],
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/dashboard")).length, 1);
});

test("identifies the route and missing JavaScript asset", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/dashboard") {
      return response(
        200,
        '<script type="module" src="/assets/entry.js"></script>',
        url.href,
        "text/html",
      );
    }
    if (url.pathname === "/assets/entry.js") {
      return response(200, 'import("./missing.js");', url.href, "application/javascript");
    }
    if (url.pathname === "/assets/missing.js") {
      return response(404, "<!doctype html>", url.href, "text/html");
    }
    return response(
      200,
      '<script type="module" src="/assets/entry.js"></script>',
      url.href,
      "text/html",
    );
  };

  const results = await verifyPublishedChunks({
    publicUrl: "https://visitecrm.com",
    protectedHeaders: { Authorization: "Bearer short-lived-test-token" },
    fetchImpl,
  });
  const protectedResult = results.find((result) => result.route === "/dashboard");

  assert.equal(protectedResult?.ok, false);
  assert.match(
    protectedResult?.failures.join("\n") ?? "",
    /\/dashboard: JavaScript asset https:\/\/visitecrm\.com\/assets\/missing\.js failed: HTTP 404/,
  );
});

test("crawls the local build's public and configured protected routes recursively without auth", async () => {
  const calls = [];
  const baseUrl = "http://127.0.0.1:4173";
  const configuredPaths = new Set([
    "/",
    "/meu-painel",
    "/vouchers",
    "/admin",
    "/admin/tenants",
    "/perfil",
  ]);
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.href, init });
    assert.equal(url.origin, baseUrl);
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers.Cookie, undefined);

    if (configuredPaths.has(url.pathname)) {
      return response(
        200,
        '<script type="module" src="/assets/entry.js"></script>',
        url.href,
        "text/html; charset=utf-8",
      );
    }
    if (url.pathname === "/assets/entry.js") {
      return response(
        200,
        'import("./chunks/role.js"); const shared = "assets/shared.js";',
        url.href,
        "application/javascript",
      );
    }
    if (url.pathname === "/assets/chunks/role.js") {
      return response(
        200,
        'import("./nested.js");',
        url.href,
        "text/javascript",
      );
    }
    if (url.pathname === "/assets/chunks/nested.js") {
      return response(
        200,
        "export default function RolePage() {}",
        url.href,
        "application/ecmascript",
      );
    }
    if (url.pathname === "/assets/shared.js") {
      return response(200, "export const shared = true;", url.href, "text/javascript");
    }
    throw new Error(`unexpected local request ${url.href}`);
  };

  const results = await verifyLocalBuiltChunks({
    publicUrl: baseUrl,
    environment: {
      PUBLICATION_CHUNK_SELLER_PATHS: "/meu-painel,/vouchers",
      PUBLICATION_CHUNK_SUPERADMIN_PATHS: "/admin,/admin/tenants",
      PUBLICATION_CHUNK_CLIENT_PATHS: "/perfil",
    },
    fetchImpl,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/", profile: undefined, ok: true },
      { route: "/meu-painel", profile: "seller", ok: true },
      { route: "/vouchers", profile: "seller", ok: true },
      { route: "/admin", profile: "superadmin", ok: true },
      { route: "/admin/tenants", profile: "superadmin", ok: true },
      { route: "/perfil", profile: "client", ok: true },
    ],
  );
  assert.deepEqual(results[0].assets, [
    `${baseUrl}/assets/entry.js`,
    `${baseUrl}/assets/chunks/role.js`,
    `${baseUrl}/assets/shared.js`,
    `${baseUrl}/assets/chunks/nested.js`,
  ]);
  assert.ok(calls.every(({ url }) => new URL(url).origin === baseUrl));
});

test("fails a local recursive chunk crawl when a JavaScript import is served as HTML", async () => {
  const baseUrl = "http://localhost:4173";
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/" || url.pathname === "/meu-painel" ||
        url.pathname === "/admin" || url.pathname === "/perfil") {
      return response(
        200,
        '<script type="module" src="/assets/entry.js"></script>',
        url.href,
        "text/html",
      );
    }
    if (url.pathname === "/assets/entry.js") {
      return response(200, 'import("./lazy.js");', url.href, "application/javascript");
    }
    if (url.pathname === "/assets/lazy.js") {
      return response(200, "<!doctype html>", url.href, "text/html");
    }
    throw new Error(`unexpected local request ${url.href}`);
  };

  const results = await verifyLocalBuiltChunks({
    publicUrl: baseUrl,
    environment: {
      PUBLICATION_CHUNK_SELLER_PATHS: "/meu-painel",
      PUBLICATION_CHUNK_SUPERADMIN_PATHS: "/admin",
      PUBLICATION_CHUNK_CLIENT_PATHS: "/perfil",
    },
    fetchImpl,
  });

  assert.equal(results[0].ok, false);
  assert.match(
    results[0].failures.join("\n"),
    /\/: JavaScript asset http:\/\/localhost:4173\/assets\/lazy\.js failed: HTTP 200 .*content-type: text\/html/,
  );
});

test("refuses non-loopback URLs before fetching in local build mode", async () => {
  let fetchCalled = false;

  await assert.rejects(
    verifyLocalBuiltChunks({
      publicUrl: "https://visitecrm.com",
      environment: {},
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("fetch must not be called");
      },
    }),
    /Local built-chunk verification is restricted to loopback URLs/,
  );
  assert.equal(fetchCalled, false);
});

test("requires a protected test session without exposing a fallback credential", async () => {
  await assert.rejects(
    verifyPublishedChunks({
      publicUrl: "https://visitecrm.com",
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    }),
    /requires an authenticated session; provide a generated Clerk sign-in profile or explicit test headers/,
  );
});

test("identifies the affected profile when a publication session is rejected", async () => {
  const secret = "seller-session-must-not-appear";
  const results = await verifyPublishedChunks({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        paths: ["/meu-painel"],
        headers: { Cookie: secret },
      },
    ],
    fetchImpl: async (input) =>
      response(401, "unauthorized", new URL(input).href, "text/html"),
  });

  assert.equal(results[1].ok, false);
  assert.match(
    results[1].failures[0],
    /vendedor Clerk session was rejected \(HTTP 401\)/,
  );
  assert.match(results[1].failures[0], /PUBLICATION_CHUNK_SELLER_USER_ID/);
  assert.doesNotMatch(results[1].failures[0], new RegExp(secret));
});

test("requires a Clerk backend key and each dedicated account ID to mint CI sessions", async () => {
  await assert.rejects(
    createPublicationSignInProfiles({
      publicUrl: "https://visitecrm.com",
      environment: {},
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    }),
    /CLERK_SECRET_KEY is missing/,
  );
  await assert.rejects(
    createPublicationSignInProfiles({
      publicUrl: "https://visitecrm.com",
      secretKey: "test-backend-key",
      environment: {},
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    }),
    /PUBLICATION_CHUNK_SELLER_USER_ID/,
  );
});

test("checks seller, superadmin, and client assets with isolated protected sessions", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, headers: init.headers });

    if (
      url.pathname === "/" ||
      url.pathname === "/meu-painel" ||
      url.pathname === "/admin" ||
      url.pathname === "/perfil"
    ) {
      if (url.pathname === "/meu-painel") {
        assert.equal(init.headers.Cookie, "seller-session");
        assert.equal(init.headers.Authorization, undefined);
      }
      if (url.pathname === "/admin") {
        assert.equal(init.headers.Authorization, "Bearer superadmin-session");
        assert.equal(init.headers.Cookie, undefined);
      }
      if (url.pathname === "/perfil") {
        assert.equal(init.headers.Cookie, "client-session");
        assert.equal(init.headers.Authorization, undefined);
      }
      const chunk =
        url.pathname === "/meu-painel"
          ? "seller-lazy.js"
          : url.pathname === "/admin"
            ? "superadmin-lazy.js"
            : url.pathname === "/perfil"
              ? "client-lazy.js"
            : "entry.js";
      return response(
        200,
        `<script type="module" src="/assets/${chunk}"></script>`,
        url.href,
        "text/html; charset=utf-8",
      );
    }
    if (url.pathname === "/assets/entry.js") {
      return response(200, "export default {}", url.href, "application/javascript");
    }
    if (
      url.pathname === "/assets/seller-lazy.js" ||
      url.pathname === "/assets/superadmin-lazy.js" ||
      url.pathname === "/assets/client-lazy.js"
    ) {
      return response(200, "export default {}", url.href, "application/javascript");
    }
    throw new Error(`unexpected request ${url.href}`);
  };

  const results = await verifyPublishedChunks({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        paths: ["/meu-painel"],
        headers: { Cookie: "seller-session" },
      },
      {
        name: "superadmin",
        paths: ["/admin"],
        headers: { Authorization: "Bearer superadmin-session" },
      },
      {
        name: "client",
        paths: ["/perfil"],
        headers: { Cookie: "client-session" },
      },
    ],
    fetchImpl,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/", profile: undefined, ok: true },
      { route: "/meu-painel", profile: "seller", ok: true },
      { route: "/admin", profile: "superadmin", ok: true },
      { route: "/perfil", profile: "client", ok: true },
    ],
  );
  assert.equal(
    calls.some(
      ({ path, headers }) =>
        (path === "/admin" || path === "/perfil") &&
        JSON.stringify(headers).includes("seller-session"),
    ),
    false,
  );
  assert.equal(
    JSON.stringify(results).includes("seller-session") ||
      JSON.stringify(results).includes("superadmin-session") ||
      JSON.stringify(results).includes("client-session"),
    false,
  );
});

test("creates one-use short-lived Clerk tokens for all three protected profiles", async () => {
  const environment = {
    PUBLICATION_CHUNK_SELLER_PATHS: "/meu-painel,/vouchers",
    PUBLICATION_CHUNK_SELLER_USER_ID: "user_seller_test",
    PUBLICATION_CHUNK_SUPERADMIN_PATHS: "/admin,/admin/tenants",
    PUBLICATION_CHUNK_SUPERADMIN_USER_ID: "user_superadmin_test",
    PUBLICATION_CHUNK_CLIENT_PATHS: "/perfil",
    PUBLICATION_CHUNK_CLIENT_USER_ID: "user_client_test",
  };
  const requests = [];
  const profiles = await createPublicationSignInProfiles({
    publicUrl: "https://visitecrm.com",
    secretKey: "test-clerk-backend-key",
    environment,
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      const body = JSON.parse(init.body);
      requests.push({ url: url.href, headers: init.headers, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `sit_${body.user_id}`,
          token: `one-use-${body.user_id}`,
          url: `https://accounts.visitecrm.com/sign-in?__clerk_ticket=one-use-${body.user_id}`,
        }),
      };
    },
  });

  assert.deepEqual(
    profiles.map(({ name, paths, expectedUserId }) => ({
      name,
      paths,
      expectedUserId,
    })),
    [
      {
        name: "seller",
        paths: ["/meu-painel", "/vouchers"],
        expectedUserId: "user_seller_test",
      },
      {
        name: "superadmin",
        paths: ["/admin", "/admin/tenants"],
        expectedUserId: "user_superadmin_test",
      },
      {
        name: "client",
        paths: ["/perfil"],
        expectedUserId: "user_client_test",
      },
    ],
  );
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.url, "https://api.clerk.com/v1/sign_in_tokens");
    assert.equal(request.headers.Authorization, "Bearer test-clerk-backend-key");
    assert.equal(request.headers.Cookie, undefined);
    assert.equal(request.body.expires_in_seconds, 300);
    assert.equal(
      profiles.find((profile) => profile.expectedUserId === request.body.user_id)
        .signInToken,
      `one-use-${request.body.user_id}`,
    );
  }
});

test("reports a Clerk secret rejection without exposing the backend key", async () => {
  const secret = "test-secret-must-not-appear";
  await assert.rejects(
    createPublicationSignInProfiles({
      publicUrl: "https://visitecrm.com",
      secretKey: secret,
      environment: {
        PUBLICATION_CHUNK_SELLER_USER_ID: "user_seller_test",
        PUBLICATION_CHUNK_SUPERADMIN_USER_ID: "user_superadmin_test",
        PUBLICATION_CHUNK_CLIENT_USER_ID: "user_client_test",
      },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ code: "not_allowed", message: "Invalid secret" }] }),
      }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /published Clerk instance/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("revokes activated Clerk sessions and unused one-time tokens", async () => {
  const requests = [];
  const failures = await cleanupPublicationClerkSessions({
    profiles: [
      { name: "seller", label: "vendedor", signInTokenId: "sit_seller_test" },
      { name: "client", label: "cliente", signInTokenId: "sit_client_test" },
    ],
    sessionIds: new Map([["seller", "sess_seller_test"]]),
    secretKey: "test-clerk-backend-key",
    fetchImpl: async (input, init) => {
      requests.push({ url: new URL(input).href, init });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  assert.deepEqual(failures, []);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://api.clerk.com/v1/sessions/sess_seller_test/revoke",
      "https://api.clerk.com/v1/sign_in_tokens/sit_client_test/revoke",
    ],
  );
  assert.ok(
    requests.every(
      ({ init }) =>
        init.method === "POST" &&
        init.headers.Authorization === "Bearer test-clerk-backend-key",
    ),
  );
});

function fakeBrowserFactory({
  responseStatus = 200,
  contentType = "text/javascript",
  requestUrl = "https://visitecrm.com/assets/interaction.js",
  responseUrl = "https://visitecrm.com/assets/interaction.js",
  authState,
  authStateByProfile,
  ticketRedemptionFails = false,
  mainHeadingVisibleByRoute = {},
  mainHeadingMatchesMarkerByRoute = {},
  runtimeExceptionsByRoute = {},
  interactionCountByRoute = {},
  delayedRuntimeExceptionByRoute = {},
  delayedRouteSessionReadsByPath = {},
} = {}) {
  const listeners = new Map();
  let navigationNumber = 0;
  let executionContextId = 0;
  const calls = [];
  const contentChecks = [];
  const executionContextIdByPath = new Map();
  const sessionStateReadsByPath = new Map();
  function emitConfiguredRuntimeException(pathname, phase, contextId) {
    const phases = runtimeExceptionsByRoute[pathname] ?? [];
    const isPromiseRejection =
      phase === "navigation" && phases.includes("promise-rejection");
    if (!phases.includes(phase) && !isPromiseRejection) return;
    listeners.get("Runtime.exceptionThrown")?.({
      exceptionDetails: {
        exceptionId: navigationNumber + 1,
        executionContextId: contextId,
        text: isPromiseRejection ? "Uncaught (in promise)" : "Uncaught Error",
        exception: {
          description: isPromiseRejection
            ? "Error: private@example.com order=customer-private-value"
            : "private@example.com token=must-not-be-logged",
        },
      },
    });
  }
  return {
    calls,
    contentChecks,
    factory: async ({ headers, profileName }) => {
      const browserCall = { headers, navigations: [] };
      calls.push(browserCall);
      const browserAuthState =
        authStateByProfile?.[profileName] ?? authState;
      let currentUrl = "about:blank";
      const client = {
        on(method, listener) {
          listeners.set(method, listener);
        },
        async send(method, params = {}) {
          if (method === "Page.navigate") {
            browserCall.navigations.push(params.url);
            const requestedUrl = new URL(params.url);
            currentUrl = requestedUrl.href;
            const pathname = new URL(currentUrl).pathname;
            const contextId = ++executionContextId;
            executionContextIdByPath.set(pathname, contextId);
            listeners.get("Runtime.executionContextCreated")?.({
              context: { id: contextId, auxData: { isDefault: true } },
            });
            emitConfiguredRuntimeException(
              pathname,
              "navigation",
              contextId,
            );
            const delayedSourceRoute = delayedRuntimeExceptionByRoute[pathname];
            const delayedSourceContextId =
              executionContextIdByPath.get(delayedSourceRoute);
            if (delayedSourceContextId !== undefined) {
              listeners.get("Runtime.exceptionThrown")?.({
                exceptionDetails: {
                  exceptionId: navigationNumber + 1,
                  executionContextId: delayedSourceContextId,
                  text: "Uncaught (in promise)",
                  exception: {
                    description:
                      "Error: private@example.com order=customer-private-value",
                  },
                },
              });
            }
            navigationNumber += 1;
            const requestId = String(navigationNumber);
            listeners.get("Network.requestWillBeSent")?.({
              requestId,
              request: { url: requestUrl },
              type: "Script",
            });
            listeners.get("Network.responseReceived")?.({
              requestId,
              type: "Script",
              response: {
                url: responseUrl,
                status: responseStatus,
                mimeType: contentType,
              },
            });
          }
          if (method === "Runtime.evaluate") {
            if (params.expression?.includes("clerk.client.signIn.create")) {
              browserCall.ticketRedemptionExpression = params.expression;
              return ticketRedemptionFails
                ? { exceptionDetails: { text: "ticket redemption failed" } }
                : {
                    result: {
                      value: {
                        sessionId: browserAuthState?.sessionId,
                        active: true,
                      },
                    },
                  };
            }
            if (params.expression?.includes("window.Clerk")) {
              const location = new URL(currentUrl);
              const readCount =
                (sessionStateReadsByPath.get(location.pathname) ?? 0) + 1;
              sessionStateReadsByPath.set(location.pathname, readCount);
              const isSessionLoading =
                readCount <=
                (delayedRouteSessionReadsByPath[location.pathname] ?? 0);
              const userId = isSessionLoading
                ? null
                : (browserAuthState?.userId ?? null);
              const sessionId = isSessionLoading
                ? null
                : (browserAuthState?.sessionId ?? null);
              return {
                result: {
                  value: {
                    origin: location.origin,
                    pathname: location.pathname,
                    documentTitle: "VisiteCRM",
                    clerkPresent: true,
                    clerkLoaded: !isSessionLoading,
                    userId,
                    sessionId,
                    hasUser: Boolean(userId),
                    hasSession: Boolean(sessionId),
                  },
                },
              };
            }
            if (params.expression?.includes("element.click()")) {
              emitConfiguredRuntimeException(
                new URL(currentUrl).pathname,
                "interaction",
              );
              return { result: { value: true } };
            }
            if (params.expression?.includes("document.querySelectorAll(")) {
              const pathname = new URL(currentUrl).pathname;
              return {
                result: { value: interactionCountByRoute[pathname] ?? 0 },
              };
            }
            if (params.expression?.includes('document.querySelector("main h1")')) {
              const pathname = new URL(currentUrl).pathname;
              contentChecks.push({ pathname, expression: params.expression });
              return {
                result: {
                  value:
                    (mainHeadingVisibleByRoute[pathname] ?? true) &&
                    (mainHeadingMatchesMarkerByRoute[pathname] ?? true),
                },
              };
            }
            return { result: { value: 0 } };
          }
          return {};
        },
        close() {},
      };
      return {
        client,
        process: { kill() {} },
        profileDirectory: "/tmp/publication-chunks-test",
      };
    },
  };
}

test("navigates every configured protected route and validates browser-observed chunks", async () => {
  const browser = fakeBrowserFactory();
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedPaths: ["/dashboard", "/trips"],
    protectedHeaders: { Cookie: "clerk_test_session=short-lived" },
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, ok, assets }) => ({ route, ok, assets })),
    [
      {
        route: "/dashboard",
        ok: true,
        assets: ["https://visitecrm.com/assets/interaction.js"],
      },
      {
        route: "/trips",
        ok: true,
        assets: ["https://visitecrm.com/assets/interaction.js"],
      },
    ],
  );
  assert.equal(browser.calls[0].headers.Cookie, "clerk_test_session=short-lived");
});

test("rejects blank and incorrectly blocked authenticated pages with profile and route", async () => {
  const browser = fakeBrowserFactory({
    mainHeadingVisibleByRoute: { "/admin/tenants": false },
    mainHeadingMatchesMarkerByRoute: { "/admin": false },
  });
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "superadmin",
        label: "superadmin",
        paths: ["/admin", "/admin/tenants"],
        headers: { Cookie: "short-lived-test-session" },
      },
    ],
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(results.map(({ route, ok }) => ({ route, ok })), [
    { route: "/admin", ok: false },
    { route: "/admin/tenants", ok: false },
  ]);
  assert.match(
    results[0].failures.join("\n"),
    /\/admin: superadmin page is missing its visible main-content marker \(main h1 must contain the configured page title\)/,
  );
  assert.match(
    results[1].failures.join("\n"),
    /\/admin\/tenants: superadmin page is missing its visible main-content marker \(main h1 must contain the configured page title\)/,
  );
  assert.doesNotMatch(
    JSON.stringify(results),
    /short-lived-test-session/,
  );
});

test("accepts cached JavaScript assets reported as not modified by the browser", async () => {
  const browser = fakeBrowserFactory({
    responseStatus: 304,
    contentType: "application/javascript",
  });
  const [result] = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedPaths: ["/dashboard"],
    protectedHeaders: { Cookie: "clerk_test_session=short-lived" },
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("reports uncaught browser exceptions for the active profile and route without exposing details", async () => {
  const browser = fakeBrowserFactory({
    runtimeExceptionsByRoute: {
      "/meu-painel": ["navigation"],
      "/admin": ["interaction"],
    },
    interactionCountByRoute: { "/admin": 1 },
  });
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        label: "vendedor",
        paths: ["/meu-painel"],
        headers: { Cookie: "seller-private-session" },
      },
      {
        name: "superadmin",
        label: "superadmin",
        paths: ["/admin"],
        headers: { Cookie: "admin-private-session" },
      },
      {
        name: "client",
        label: "cliente",
        paths: ["/perfil"],
        headers: { Cookie: "client-private-session" },
      },
    ],
    interactionSelectors: ['button[aria-haspopup="menu"]'],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/meu-painel", profile: "seller", ok: false },
      { route: "/admin", profile: "superadmin", ok: false },
      { route: "/perfil", profile: "client", ok: true },
    ],
  );
  assert.match(
    results[0].failures.join("\n"),
    /\/meu-painel: vendedor route reported an uncaught JavaScript exception/,
  );
  assert.match(
    results[1].failures.join("\n"),
    /\/admin: superadmin route reported an uncaught JavaScript exception/,
  );
  const output = JSON.stringify(results);
  assert.doesNotMatch(
    output,
    /private@example\.com|must-not-be-logged|seller-private-session|admin-private-session|client-private-session/,
  );
});

test("fails a client route on an unhandled promise rejection without exposing its payload", async () => {
  const browser = fakeBrowserFactory({
    runtimeExceptionsByRoute: { "/perfil": ["promise-rejection"] },
  });
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "client",
        label: "cliente",
        paths: ["/perfil"],
        headers: { Cookie: "client-private-session" },
      },
    ],
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.equal(results[0].ok, false);
  assert.equal(results[0].profile, "client");
  assert.equal(results[0].route, "/perfil");
  assert.match(
    results[0].failures.join("\n"),
    /\/perfil: cliente route reported an uncaught JavaScript exception/,
  );
  assert.doesNotMatch(
    JSON.stringify(results),
    /private@example\.com|customer-private-value|client-private-session|Uncaught \(in promise\)/,
  );
});

test("keeps delayed browser exceptions attached to the route that created their execution context", async () => {
  const browser = fakeBrowserFactory({
    delayedRuntimeExceptionByRoute: {
      "/vouchers": "/meu-painel",
    },
  });
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        label: "vendedor",
        paths: ["/meu-painel", "/vouchers"],
        headers: { Cookie: "seller-private-session" },
      },
    ],
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/meu-painel", profile: "seller", ok: false },
      { route: "/vouchers", profile: "seller", ok: true },
    ],
  );
  assert.match(
    results[0].failures.join("\n"),
    /\/meu-painel: vendedor route reported an uncaught JavaScript exception/,
  );
  assert.doesNotMatch(
    JSON.stringify(results),
    /private@example\.com|customer-private-value|seller-private-session/,
  );
});

test("redeems one-use Clerk tickets for isolated seller, superadmin, and client browser sessions", async () => {
  const browser = fakeBrowserFactory({
    authStateByProfile: {
      seller: { userId: "user_seller_test", sessionId: "sess_seller_test" },
      superadmin: {
        userId: "user_superadmin_test",
        sessionId: "sess_superadmin_test",
      },
      client: { userId: "user_client_test", sessionId: "sess_client_test" },
    },
  });
  const createdSessions = [];
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        label: "vendedor",
        paths: ["/meu-painel", "/vouchers"],
        signInToken: "seller-token",
        expectedUserId: "user_seller_test",
      },
      {
        name: "superadmin",
        label: "superadmin",
        paths: ["/admin", "/admin/tenants"],
        signInToken: "admin-token",
        expectedUserId: "user_superadmin_test",
      },
      {
        name: "client",
        label: "cliente",
        paths: ["/perfil"],
        signInToken: "client-token",
        expectedUserId: "user_client_test",
      },
    ],
    onSessionCreated: (session) => createdSessions.push(session),
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/meu-painel", profile: "seller", ok: true },
      { route: "/vouchers", profile: "seller", ok: true },
      { route: "/admin", profile: "superadmin", ok: true },
      { route: "/admin/tenants", profile: "superadmin", ok: true },
      { route: "/perfil", profile: "client", ok: true },
    ],
  );
  const contentMarkersByPath = Object.fromEntries(
    browser.contentChecks.map(({ pathname, expression }) => [pathname, expression]),
  );
  assert.match(contentMarkersByPath["/meu-painel"], /Meu Painel/);
  assert.match(contentMarkersByPath["/vouchers"], /Vouchers e Check-in/);
  assert.match(contentMarkersByPath["/admin"], /Visão Geral da Plataforma/);
  assert.match(contentMarkersByPath["/admin/tenants"], /Tenants/);
  assert.match(contentMarkersByPath["/perfil"], /Tem mundo te esperando\./);
  assert.doesNotMatch(contentMarkersByPath["/perfil"], /Oi,/);
  assert.deepEqual(
    browser.calls.map(({ headers }) => ({
      Cookie: headers.Cookie,
      Authorization: headers.Authorization,
    })),
    [
      { Cookie: undefined, Authorization: undefined },
      { Cookie: undefined, Authorization: undefined },
      { Cookie: undefined, Authorization: undefined },
    ],
  );
  assert.deepEqual(
    createdSessions,
    [
      { profileName: "seller", sessionId: "sess_seller_test" },
      { profileName: "superadmin", sessionId: "sess_superadmin_test" },
      { profileName: "client", sessionId: "sess_client_test" },
    ],
  );
  assert.deepEqual(
    browser.calls.map(({ navigations, ticketRedemptionExpression }) => ({
      firstNavigation: navigations[0],
      redeemsTicket: ticketRedemptionExpression?.includes(
        "strategy: \"ticket\"",
      ),
    })),
    [
      { firstNavigation: "https://visitecrm.com/", redeemsTicket: true },
      { firstNavigation: "https://visitecrm.com/", redeemsTicket: true },
      { firstNavigation: "https://visitecrm.com/", redeemsTicket: true },
    ],
  );
});

test("waits for Clerk to restore its ticket session after a protected-route reload", async () => {
  const browser = fakeBrowserFactory({
    authStateByProfile: {
      seller: { userId: "user_seller_test", sessionId: "sess_seller_test" },
    },
    delayedRouteSessionReadsByPath: {
      "/meu-painel": 2,
    },
  });
  const results = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedProfiles: [
      {
        name: "seller",
        label: "vendedor",
        paths: ["/meu-painel"],
        signInToken: "seller-token",
        expectedUserId: "user_seller_test",
      },
    ],
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [{ route: "/meu-painel", profile: "seller", ok: true }],
  );
});

test("reports privacy-safe diagnostics when Clerk rejects a one-use ticket", async () => {
  const browser = fakeBrowserFactory({
    ticketRedemptionFails: true,
  });

  await assert.rejects(
    verifyPublishedInteractions({
      publicUrl: "https://visitecrm.com",
      protectedProfiles: [
        {
          name: "seller",
          label: "vendedor",
          paths: ["/meu-painel"],
          signInToken: "private-ticket-value",
          expectedUserId: "user_private_test_id",
        },
      ],
      interactionSelectors: [],
      browserFactory: browser.factory,
      timeoutMs: 1,
    }),
    (error) => {
      assert.match(
        error.message,
        /Clerk could not redeem the one-use vendedor CI sign-in token/,
      );
      assert.doesNotMatch(
        error.message,
        /private-ticket-value|user_private_test_id/,
      );
      return true;
    },
  );
});

test("fails when an interacted route serves a non-JavaScript response", async () => {
  const browser = fakeBrowserFactory({
    responseStatus: 200,
    contentType: "text/html",
  });
  const [result] = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedPaths: ["/dashboard"],
    protectedHeaders: { Authorization: "Bearer short-lived-test-token" },
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /content-type: text\/html/);
});

test("fails when an observed chunk resolves outside the published origin", async () => {
  const browser = fakeBrowserFactory({
    responseUrl: "https://cdn.example.test/interaction.js",
  });
  const [result] = await verifyPublishedInteractions({
    publicUrl: "https://visitecrm.com",
    protectedPaths: ["/dashboard"],
    protectedHeaders: { Cookie: "short-lived-test-session" },
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join("\n"), /unexpected origin https:\/\/cdn\.example\.test/);
});