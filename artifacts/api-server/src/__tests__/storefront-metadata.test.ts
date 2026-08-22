import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStorefrontMetadata,
  injectStorefrontMetadata,
} from "../lib/storefront-metadata.js";

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
});