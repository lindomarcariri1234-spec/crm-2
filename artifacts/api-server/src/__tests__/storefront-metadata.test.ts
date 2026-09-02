import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStorefrontMetadata,
  injectStorefrontMetadata,
  productSlugFromStorefrontPath,
} from "../lib/storefront-metadata.js";
import { shouldBypassClerkForPath } from "../lib/clerk-request.js";

const store = {
  name: "Visite Cariri Cearense Receptivo",
  slug: "visite-cariri-cearense-receptivo",
  tagline: "Onde a cultura respira, a natureza inspira e a fé fortalece.",
  description: "Pacotes, excursões, passeios e experiências inesquecíveis pelo Cariri.",
  logo: "https://utfs.io/f/logo.png",
  favicon: "https://utfs.io/f/favicon.png",
  bannerHome: "https://utfs.io/f/banner.png",
  metaTitle: "Visite Cariri Cearense Receptivo — Turismo no Cariri",
  metaDescription: "Viagens, excursões e experiências inesquecíveis pelo Cariri e Chapada do Araripe.",
  metaKeywords: "Turismo, Viagens, Cariri Cearense",
  customDomain: null,
  domainVerified: false,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("storefront sharing metadata", () => {
  it("keeps storefront HTML routes public before metadata injection", () => {
    expect(shouldBypassClerkForPath("/loja/visite-cariri-cearense-receptivo")).toBe(true);
    expect(shouldBypassClerkForPath(
      "/loja/visite-cariri-cearense-receptivo/produtos/roteiro-cariri",
    )).toBe(true);
    expect(shouldBypassClerkForPath("/lojista/configuracoes")).toBe(false);
  });

  it("uses agency SEO, identity assets, and the shared storefront URL", () => {
    vi.stubEnv("STORE_PUBLIC_URL", "https://visitecrm.com");

    const metadata = buildStorefrontMetadata(
      store,
      "/loja/visite-cariri-cearense-receptivo/produtos",
      "untrusted.example",
    );

    expect(metadata.title).toBe("Visite Cariri Cearense Receptivo — Turismo no Cariri");
    expect(metadata.description).toBe(
      "Viagens, excursões e experiências inesquecíveis pelo Cariri e Chapada do Araripe.",
    );
    expect(metadata.keywords).toBe("Turismo, Viagens, Cariri Cearense");
    expect(metadata.canonicalUrl).toBe(
      "https://visitecrm.com/loja/visite-cariri-cearense-receptivo/produtos",
    );
    expect(metadata.faviconUrl).toBe("https://utfs.io/f/favicon.png");
    expect(metadata.imageUrl).toBe("https://utfs.io/f/banner.png");

    const shell = "<head><!-- VITRINE_METADATA_START --><!-- VITRINE_METADATA_END --></head>";
    const html = injectStorefrontMetadata(shell, metadata);

    expect(html).toContain('property="og:title" content="Visite Cariri Cearense Receptivo — Turismo no Cariri"');
    expect(html).toContain('property="og:image" content="https://utfs.io/f/banner.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="category" content="Agência de viagens"');
    expect(html).toContain('"@type":"TravelAgency"');
  });

  it("falls back to public agency details and does not trust an unrelated Host header", () => {
    vi.stubEnv("STORE_PUBLIC_URL", "https://visitecrm.com");
    const metadata = buildStorefrontMetadata(
      {
        ...store,
        metaTitle: null,
        metaDescription: null,
        metaKeywords: null,
        bannerHome: null,
        bannerMobile: null,
        logo: null,
        favicon: null,
        customDomain: "agencia.example.com",
        domainVerified: true,
      },
      "/loja/visite-cariri-cearense-receptivo",
      "attacker.example.com",
    );

    expect(metadata.title).toBe(store.name);
    expect(metadata.description).toBe(store.tagline);
    expect(metadata.keywords).toContain(store.name);
    expect(metadata.imageUrl).toBeNull();
    expect(metadata.faviconUrl).toBe("https://visitecrm.com/favicon.svg");
    expect(metadata.canonicalUrl).toBe("https://visitecrm.com/loja/visite-cariri-cearense-receptivo");
  });

  it("uses a verified custom domain only when it matches the request and escapes page content", () => {
    vi.stubEnv("STORE_PUBLIC_URL", "https://visitecrm.com");
    const metadata = buildStorefrontMetadata(
      {
        ...store,
        name: 'Agência <script>alert("xss")</script>',
        metaTitle: null,
        customDomain: "agencia.example.com",
        domainVerified: true,
      },
      "/loja/visite-cariri-cearense-receptivo/produtos",
      "agencia.example.com:443",
    );

    expect(metadata.canonicalUrl).toBe(
      "https://agencia.example.com/loja/visite-cariri-cearense-receptivo/produtos",
    );

    const html = injectStorefrontMetadata(
      "<head><!-- VITRINE_METADATA_START --><!-- VITRINE_METADATA_END --></head>",
      metadata,
    );
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("\\u003cscript>");
  });

  it("uses an active package's SEO and image for a product URL", () => {
    vi.stubEnv("STORE_PUBLIC_URL", "https://visitecrm.com");
    const metadata = buildStorefrontMetadata(
      store,
      "/loja/visite-cariri-cearense-receptivo/produtos/roteiro-cariri",
      "visitecrm.com",
      {
        name: "Roteiro Cariri Completo",
        description: "<p>Uma viagem com cultura, natureza e fé.</p>",
        shortDescription: "Conheça o melhor do Cariri.",
        thumbnail: null,
        images: ["https://utfs.io/f/roteiro-cariri.jpg"],
        gallery: ["https://utfs.io/f/gallery.jpg"],
        metaTitle: "Roteiro Cariri Completo — 5 dias",
        metaDescription: "Conheça o Cariri em cinco dias com roteiro completo.",
        metaKeywords: "Cariri, viagem, Chapada do Araripe",
        price: "1299.90",
        onSale: true,
        salePrice: "999.90",
        saleStartsAt: "2000-01-01T00:00:00.000Z",
        saleEndsAt: "2099-12-31T23:59:59.000Z",
        departureDate: "not-a-date",
        startDate: "2099-09-15",
      },
    );

    expect(metadata.title).toBe("Roteiro Cariri Completo — 5 dias");
    expect(metadata.description).toContain("Conheça o Cariri em cinco dias com roteiro completo.");
    expect(metadata.description).toContain("Saída em 15/09/2099");
    expect(metadata.description).toContain("A partir de");
    expect(metadata.description).toContain("999,90");
    expect(metadata.keywords).toBe("Cariri, viagem, Chapada do Araripe");
    expect(metadata.imageUrl).toBe("https://utfs.io/f/roteiro-cariri.jpg");
    expect(metadata.jsonLd).toContain('"@type":"Product"');
    expect(metadata.jsonLd).toContain('"name":"Roteiro Cariri Completo"');
  });

  it("does not advertise expired promotions or past departures", () => {
    const metadata = buildStorefrontMetadata(
      store,
      "/loja/visite-cariri-cearense-receptivo/produtos/roteiro-antigo",
      "visitecrm.com",
      {
        name: "Roteiro Histórico",
        description: "Uma viagem com roteiro cultural.",
        price: "1299.90",
        onSale: true,
        salePrice: "899.90",
        saleEndsAt: "2000-01-01T00:00:00.000Z",
        departureDate: "2000-01-01",
      },
    );

    expect(metadata.description).toContain("A partir de");
    expect(metadata.description).toContain("1.299,90");
    expect(metadata.description).not.toContain("899,90");
    expect(metadata.description).not.toContain("Saída em");
  });

  it("only selects a package slug from an exact product route", () => {
    expect(productSlugFromStorefrontPath(
      "/loja/visite-cariri-cearense-receptivo/produtos/roteiro%20cariri",
      "visite-cariri-cearense-receptivo",
    )).toBe("roteiro cariri");
    expect(productSlugFromStorefrontPath(
      "/loja/visite-cariri-cearense-receptivo/produtos",
      "visite-cariri-cearense-receptivo",
    )).toBeNull();
    expect(productSlugFromStorefrontPath(
      "/loja/visite-cariri-cearense-receptivo/indicacao",
      "visite-cariri-cearense-receptivo",
    )).toBeNull();
  });
});
