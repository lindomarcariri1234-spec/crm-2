import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import indexHandler from "../api/index.mjs";
import catchAllHandler from "../api/[...path].mjs";
import {
  isApiRootRequest,
  restoreRewrittenApiPath,
} from "../api/request-routing.mjs";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test("both Vercel API handlers return a safe 404 for the API root without loading the bundle", async () => {
  for (const handler of [indexHandler, catchAllHandler]) {
    for (const url of ["/api", "/api/", "/?__vercel_api_path="]) {
      const response = createResponse();
      await handler({ url }, response);
      assert.equal(response.statusCode, 404);
      assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
      assert.deepEqual(JSON.parse(response.body), { error: "NOT_FOUND" });
    }
  }
});

test("healthz remains a subroute and is restored from Vercel's forwarded path", () => {
  for (const url of ["/api/healthz", "/?__vercel_api_path=healthz"]) {
    const request = { url };
    assert.equal(isApiRootRequest(request), false);
    restoreRewrittenApiPath(request);
    assert.equal(new URL(request.url, "http://vercel.internal").pathname, "/api/healthz");
  }
});

test("Vercel keeps the public health endpoint explicitly proxied to the live API", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const healthRewrite = config.rewrites.find((rewrite) => rewrite.source === "/api/healthz");
  assert.equal(
    healthRewrite?.destination,
    "https://crm-2-lindomarcariri.replit.app/api/healthz",
  );
});
