import { describe, expect, it, vi } from "vitest";
import { createStorefrontHandler } from "./storefront.mjs";

const store = {
  name: "Agência Sol & Mar",
  metaTitle: "Férias inesquecíveis no Nordeste",
  metaDescription: "Pacotes exclusivos com saída de Fortaleza.",
  metaKeywords: "nordeste, praias, excursões",
  bannerHome: "https://cdn.example.com/sol-mar.jpg",
  tagline: "A sua próxima viagem começa aqui.",
};

const sourceIndex = `<!doctype html>
<html><head>
  <title>VisiteCRM padrão</title>
  <meta name="description" content="Descrição padrão do VisiteCRM">
  <!-- VITRINE_METADATA_START -->
  <title id="page-title">VisiteCRM padrão</title>
  <meta id="page-og-title" property="og:title" content="VisiteCRM padrão">
  <!-- VITRINE_METADATA_END -->
</head><body></body></html>`;

function responseFor(htmlRef) {
  const headers = new Map();
  return {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(body) {
      htmlRef.value = body;
    },
    headers,
  };
}

function crawlerRequest(path) {
  return {
    url: `/api/storefront?store_slug=minha-loja${path ? `&store_path=${encodeURIComponent(path)}` : ""}`,
    headers: { "user-agent": "facebookexternalhit/1.1 Twitterbot/1.0" },
  };
}

describe("Vercel storefront crawler metadata", () => {
  it.each([
    ["/loja/minha-loja", ""],
    ["/loja/minha-loja/indicacao", "indicacao"],
  ])("renders agency metadata for %s instead of the default index metadata", async (_label, storePath) => {
    const body = { value: "" };
    const response = responseFor(body);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => store,
    });
    const handler = createStorefrontHandler({
      fetchImpl,
      readIndex: async () => sourceIndex,
    });

    await handler(crawlerRequest(storePath), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body.value).toContain("<title id=\"page-title\">Férias inesquecíveis no Nordeste</title>");
    expect(body.value).toContain(
      '<meta id="page-og-title" property="og:title" content="Férias inesquecíveis no Nordeste" />',
    );
    expect(body.value).toContain(
      '<meta id="page-og-description" property="og:description" content="Pacotes exclusivos com saída de Fortaleza." />',
    );
    expect(body.value).toContain(
      '<meta id="page-og-image" property="og:image" content="https://cdn.example.com/sol-mar.jpg" />',
    );
    expect(body.value).toContain(
      '<meta id="page-twitter-image" name="twitter:image" content="https://cdn.example.com/sol-mar.jpg" />',
    );
    expect(body.value).toContain(
      `<link id="page-canonical" rel="canonical" href="https://visitecrm.com/loja/minha-loja${storePath ? "/indicacao" : ""}" />`,
    );
    expect(body.value).not.toContain("VisiteCRM padrão");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://crm-2-lindomarcariri.replit.app/api/public/store/minha-loja",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "VisiteCRM storefront metadata" }),
      }),
    );
  });
});