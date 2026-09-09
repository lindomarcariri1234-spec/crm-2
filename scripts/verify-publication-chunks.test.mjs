import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProtectedPublicationRouteCoverage,
  getChangedProtectedPublicationRoutes,
  getProtectedPublicationRoutes,
  getWorkflowPublicationPaths,
  verifyPublishedChunks,
  verifyPublishedInteractions,
} from "./verify-publication-chunks.mjs";

function response(status, body, url, contentType) {
  return {
    status,
    url,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

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

test("requires a protected test session without exposing a fallback credential", async () => {
  await assert.rejects(
    verifyPublishedChunks({
      publicUrl: "https://visitecrm.com",
      fetchImpl: async () => {
        throw new Error("fetch must not be called");
      },
    }),
    /requires PUBLICATION_CHUNK_AUTHORIZATION or PUBLICATION_CHUNK_COOKIE/,
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
    /vendedor publication session was rejected \(HTTP 401\)/,
  );
  assert.match(results[1].failures[0], /PUBLICATION_CHUNK_SELLER_COOKIE/);
  assert.doesNotMatch(results[1].failures[0], new RegExp(secret));
});

test("rejects an expired profile session before making a request", async () => {
  const environment = {
    PUBLICATION_CHUNK_SELLER_PATHS: "/meu-painel",
    PUBLICATION_CHUNK_SELLER_COOKIE: "seller-session",
    PUBLICATION_CHUNK_SUPERADMIN_PATHS: "/admin",
    PUBLICATION_CHUNK_SUPERADMIN_COOKIE: "superadmin-session",
    PUBLICATION_CHUNK_CLIENT_PATHS: "/perfil",
    PUBLICATION_CHUNK_CLIENT_COOKIE: "client-session",
    PUBLICATION_CHUNK_SELLER_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
  };
  const previousValues = new Map(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);

  try {
    await assert.rejects(
      verifyPublishedChunks({
        publicUrl: "https://visitecrm.com",
        fetchImpl: async () => {
          throw new Error("fetch must not be called");
        },
      }),
      /vendedor publication session expired at 2020-01-01T00:00:00\.000Z.*PUBLICATION_CHUNK_SELLER_COOKIE/,
    );
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test("loads seller, superadmin, and client sessions from profile environment variables", async () => {
  const environment = {
    PUBLICATION_CHUNK_SELLER_PATHS: "/meu-painel,/vouchers",
    PUBLICATION_CHUNK_SELLER_COOKIE: "seller-env-session",
    PUBLICATION_CHUNK_SUPERADMIN_PATHS: "/admin,/admin/tenants",
    PUBLICATION_CHUNK_SUPERADMIN_AUTHORIZATION: "Bearer superadmin-env-session",
    PUBLICATION_CHUNK_CLIENT_PATHS: "/perfil",
    PUBLICATION_CHUNK_CLIENT_COOKIE: "client-env-session",
  };
  const previousValues = new Map(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);

  try {
    const fetchImpl = async (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/") {
        return response(
          200,
          '<script type="module" src="/assets/entry.js"></script>',
          url.href,
          "text/html",
        );
      }
      if (url.pathname === "/meu-painel" || url.pathname === "/vouchers") {
        assert.equal(init.headers.Cookie, "seller-env-session");
        return response(
          200,
          `<script type="module" src="/assets/${url.pathname === "/vouchers" ? "vouchers" : "seller"}.js"></script>`,
          url.href,
          "text/html",
        );
      }
      if (url.pathname === "/admin" || url.pathname === "/admin/tenants") {
        assert.equal(init.headers.Authorization, "Bearer superadmin-env-session");
        return response(
          200,
          `<script type="module" src="/assets/${url.pathname === "/admin/tenants" ? "tenants" : "superadmin"}.js"></script>`,
          url.href,
          "text/html",
        );
      }
      if (url.pathname === "/perfil") {
        assert.equal(init.headers.Cookie, "client-env-session");
        return response(
          200,
          '<script type="module" src="/assets/client.js"></script>',
          url.href,
          "text/html",
        );
      }
      return response(200, "export default {}", url.href, "application/javascript");
    };

    const results = await verifyPublishedChunks({
      publicUrl: "https://visitecrm.com",
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
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function fakeBrowserFactory({
  responseStatus = 200,
  contentType = "text/javascript",
  requestUrl = "https://visitecrm.com/assets/interaction.js",
  responseUrl = "https://visitecrm.com/assets/interaction.js",
} = {}) {
  const listeners = new Map();
  let navigationNumber = 0;
  const calls = [];
  return {
    calls,
    factory: async ({ headers }) => {
      calls.push({ headers });
      const client = {
        on(method, listener) {
          listeners.set(method, listener);
        },
        async send(method) {
          if (method === "Page.navigate") {
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

test("uses a separate browser session for each protected profile", async () => {
  const browser = fakeBrowserFactory();
  const results = await verifyPublishedInteractions({
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
    interactionSelectors: [],
    browserFactory: browser.factory,
    timeoutMs: 1,
  });

  assert.deepEqual(
    results.map(({ route, profile, ok }) => ({ route, profile, ok })),
    [
      { route: "/meu-painel", profile: "seller", ok: true },
      { route: "/admin", profile: "superadmin", ok: true },
      { route: "/perfil", profile: "client", ok: true },
    ],
  );
  assert.deepEqual(
    browser.calls.map(({ headers }) => ({
      Cookie: headers.Cookie,
      Authorization: headers.Authorization,
    })),
    [
      { Cookie: "seller-session", Authorization: undefined },
      { Cookie: undefined, Authorization: "Bearer superadmin-session" },
      { Cookie: "client-session", Authorization: undefined },
    ],
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