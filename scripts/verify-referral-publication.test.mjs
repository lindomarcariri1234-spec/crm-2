import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_PURCHASE_REFERRAL_MESSAGE,
  verifyReferralPublication,
} from "./verify-referral-publication.mjs";

const VERSION = "current-build";
const BASE_URL = "https://published.example";

function response(status, body, url, contentType = "text/html; charset=utf-8") {
  return {
    status,
    url,
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

function createFetch({ stale = false, missingPolicy = false } = {}) {
  const marker = stale ? "old-build" : VERSION;
  const entry = missingPolicy
    ? 'export default {}'
    : `const message = ${JSON.stringify(FIRST_PURCHASE_REFERRAL_MESSAGE)}; const note = {role:"note"}; export default {message,note};`;
  const html = `<meta name="visitecrm-publication" content="${marker}"><script type="module" src="/assets/index.js"></script>`;

  return async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/public/store/demo/referral/info") {
      return response(
        200,
        JSON.stringify({ firstPurchaseOnly: !missingPolicy }),
        url.href,
        "application/json; charset=utf-8",
      );
    }
    if (url.pathname === "/assets/index.js") {
      return response(200, entry, url.href, "application/javascript");
    }
    return response(200, html, url.href);
  };
}

test("checks all public referral routes, API policy, and accessible bundle copy", async () => {
  const results = await verifyReferralPublication({
    publicUrl: BASE_URL,
    expectedVersion: VERSION,
    storeSlug: "demo",
    referralCode: "PUBLIC-CODE",
    productSlug: "demo-trip",
    fetchImpl: createFetch(),
  });

  assert.deepEqual(
    results.map(({ name, ok }) => ({ name, ok })),
    [
      { name: "referral-landing", ok: true },
      { name: "checkout-direct", ok: true },
      { name: "reservation-wizard", ok: true },
      { name: "referral-info", ok: true },
      { name: "referral-message-bundle", ok: true },
    ],
  );
});

test("rejects a stale publication marker before accepting the storefront", async () => {
  const results = await verifyReferralPublication({
    publicUrl: BASE_URL,
    expectedVersion: VERSION,
    storeSlug: "demo",
    referralCode: "PUBLIC-CODE",
    productSlug: "demo-trip",
    fetchImpl: createFetch({ stale: true }),
  });

  assert.equal(results.find(({ name }) => name === "referral-landing")?.ok, false);
  assert.match(
    results.find(({ name }) => name === "referral-landing")?.message ?? "",
    /serves publication "old-build" instead of expected "current-build"/,
  );
});

test("rejects a published API or bundle that omits the first-purchase policy", async () => {
  const results = await verifyReferralPublication({
    publicUrl: BASE_URL,
    expectedVersion: VERSION,
    storeSlug: "demo",
    referralCode: "PUBLIC-CODE",
    productSlug: "demo-trip",
    fetchImpl: createFetch({ missingPolicy: true }),
  });

  assert.equal(results.find(({ name }) => name === "referral-info")?.ok, false);
  assert.equal(results.find(({ name }) => name === "referral-message-bundle")?.ok, false);
});