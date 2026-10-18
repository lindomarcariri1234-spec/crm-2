import assert from "node:assert/strict";
import test from "node:test";
import { createStorefrontHandler } from "../../../../api/storefront.mjs";

function makeResponse() {
  return {
    statusCode: 0,
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

test("renders each agency's own navigation, sharing, and search metadata", async () => {
  const stores = {
    cariri: {
      name: "Visite Cariri",
      metaTitle: "Passeios no Cariri",
      metaDescription: "Roteiros pelo Cariri Cearense.",
      metaKeywords: "Cariri, passeios",
      logo: "https://cdn.example/cariri-logo.png",
      favicon: "https://cdn.example/cariri-icon.png",
      bannerHome: "https://cdn.example/cariri-banner.png",
      phone: "+55 88 99999-0000",
      city: "Juazeiro do Norte",
      state: "CE",
    },
    praia: {
      name: "Rota das Praias",
      metaTitle: "Viagens para as praias",
      metaDescription: "Excursões para o litoral.",
      metaKeywords: "praia, excursões",
      logo: "https://cdn.example/praia-logo.png",
      favicon: "https://cdn.example/praia-icon.png",
      bannerHome: "https://cdn.example/praia-banner.png",
    },
  };
  const handler = createStorefrontHandler({
    fetchImpl: async (url) => {
      const slug = new URL(url).pathname.split("/").at(-1);
      return { ok: true, json: async () => stores[slug] };
    },
    readIndex: async () => "<html><head><!-- VITRINE_METADATA_START --><!-- VITRINE_METADATA_END --></head></html>",
  });

  for (const [slug, store] of Object.entries(stores)) {
    const response = makeResponse();
    await handler({ url: `/api/storefront?store_slug=${slug}` }, response);

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.includes(`<title id="page-title">${store.metaTitle}</title>`));
    assert.ok(response.body.includes(`property="og:title" content="${store.metaTitle}"`));
    assert.ok(response.body.includes(`name="twitter:title" content="${store.metaTitle}"`));
    assert.ok(response.body.includes(`name="description" content="${store.metaDescription}"`));
    assert.ok(response.body.includes(`name="keywords" content="${store.metaKeywords}"`));
    assert.ok(response.body.includes(`rel="icon" href="${store.favicon}"`));
    assert.ok(response.body.includes(`property="og:image" content="${store.bannerHome}"`));
    assert.ok(response.body.includes(`"name":"${store.name}"`));
    assert.ok(!response.body.includes(slug === "cariri" ? stores.praia.metaTitle : stores.cariri.metaTitle));
  }
});

test("caps metadata to consistent lengths and escapes agency content", async () => {
  const maliciousTitle = 'Agência <script>alert("x")</script>';
  const handler = createStorefrontHandler({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        name: maliciousTitle,
        metaTitle: "A".repeat(140),
        metaDescription: "D".repeat(200),
      }),
    }),
    readIndex: async () => "<head><!-- VITRINE_METADATA_START --><!-- VITRINE_METADATA_END --></head>",
  });
  const response = makeResponse();
  await handler({ url: "/api/storefront?store_slug=agency" }, response);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes(`<title id="page-title">${"A".repeat(120)}</title>`));
  assert.ok(response.body.includes(`name="description" content="${"D".repeat(180)}"`));
  assert.ok(!response.body.includes('<script>alert("x")</script>'));
  assert.ok(response.body.includes("\\u003cscript>"));
});

test("uses a verified custom domain only when it matches the incoming host", async () => {
  const handler = createStorefrontHandler({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        name: "Agência Exemplo",
        customDomain: "agencia.example.com",
        domainVerified: true,
      }),
    }),
    readIndex: async () => "<head><!-- VITRINE_METADATA_START --><!-- VITRINE_METADATA_END --></head>",
  });

  const trustedResponse = makeResponse();
  await handler({
    url: "/api/storefront?store_slug=agencia",
    headers: { host: "agencia.example.com" },
  }, trustedResponse);
  assert.ok(trustedResponse.body.includes('rel="canonical" href="https://agencia.example.com/loja/agencia"'));

  const untrustedResponse = makeResponse();
  await handler({
    url: "/api/storefront?store_slug=agencia",
    headers: { host: "attacker.example.com" },
  }, untrustedResponse);
  assert.ok(untrustedResponse.body.includes('rel="canonical" href="https://visitecrm.com/loja/agencia"'));
});
