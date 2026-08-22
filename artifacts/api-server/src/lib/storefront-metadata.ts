type StorefrontMetadataStore = {
  name: string;
  slug: string;
  tagline?: string | null;
  description?: string | null;
  logo?: string | null;
  favicon?: string | null;
  bannerHome?: string | null;
  bannerMobile?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  customDomain?: string | null;
  domainVerified?: boolean;
};

type StorefrontMetadataProduct = {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  thumbnail?: string | null;
  images?: string[] | null;
  gallery?: string[] | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
};

export type StorefrontMetadata = {
  title: string;
  description: string;
  keywords: string;
  canonicalUrl: string;
  faviconUrl: string;
  imageUrl: string | null;
  imageAlt: string | null;
  jsonLd: string;
};

const DEFAULT_STORE_PUBLIC_ORIGIN = "https://visitecrm.com";
const FALLBACK_DESCRIPTION = "Conheça nossas viagens, pacotes e experiências.";
const FALLBACK_KEYWORDS = "agência de viagens, turismo, viagens, pacotes de viagem";

function normalizedText(value: string | null | undefined, fallback: string, maxLength: number): string {
  const text = value?.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function plainText(value: string | null | undefined): string | null | undefined {
  return value?.replace(/<[^>]*>/g, " ");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function configuredPublicOrigin(): string {
  const configured = process.env["STORE_PUBLIC_URL"]?.trim() || DEFAULT_STORE_PUBLIC_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_STORE_PUBLIC_ORIGIN;
  }
}

function verifiedCustomOrigin(store: StorefrontMetadataStore, requestHost: string | undefined): string | null {
  if (!store.domainVerified || !store.customDomain?.trim() || !requestHost) return null;

  const customDomain = store.customDomain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const host = requestHost.split(":")[0]?.toLowerCase();
  if (!customDomain || customDomain !== host) return null;

  return `https://${customDomain}`;
}

function safePath(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function absoluteAssetUrl(value: string | null | undefined, origin: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstAsset(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

export function productSlugFromStorefrontPath(pathname: string, storeSlug: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length !== 4
    || parts[0] !== "loja"
    || parts[1] !== storeSlug
    || parts[2] !== "produtos"
  ) {
    return null;
  }

  try {
    return decodeURIComponent(parts[3] ?? "") || null;
  } catch {
    return null;
  }
}

/**
 * Builds the public metadata used by social crawlers. The request host is only
 * accepted when it matches a verified custom domain, preventing host-header
 * injection into canonical/OG URLs.
 */
export function buildStorefrontMetadata(
  store: StorefrontMetadataStore,
  requestPath: string,
  requestHost?: string,
  product?: StorefrontMetadataProduct | null,
): StorefrontMetadata {
  const publicOrigin = verifiedCustomOrigin(store, requestHost) ?? configuredPublicOrigin();
  const canonicalUrl = new URL(safePath(requestPath), publicOrigin).toString();
  const storeDescription = normalizedText(
    store.metaDescription,
    normalizedText(store.tagline, normalizedText(plainText(store.description), FALLBACK_DESCRIPTION, 180), 180),
    180,
  );
  const isProductPage = Boolean(product);
  const title = isProductPage
    ? normalizedText(product?.metaTitle, product?.name ?? store.name, 120)
    : normalizedText(store.metaTitle, store.name, 120);
  const description = isProductPage
    ? normalizedText(
      product?.metaDescription,
      normalizedText(
        product?.shortDescription,
        normalizedText(plainText(product?.description), storeDescription, 180),
        180,
      ),
      180,
    )
    : storeDescription;
  const keywords = isProductPage
    ? normalizedText(
      product?.metaKeywords,
      `${product?.name ?? store.name}, ${store.metaKeywords ?? FALLBACK_KEYWORDS}`,
      400,
    )
    : normalizedText(store.metaKeywords, `${store.name}, ${FALLBACK_KEYWORDS}`, 400);
  const productImage = firstAsset(
    product?.thumbnail,
    ...(product?.images ?? []),
    ...(product?.gallery ?? []),
  );
  const imageUrl = absoluteAssetUrl(
    productImage ?? store.bannerHome ?? store.bannerMobile ?? store.logo,
    publicOrigin,
  );
  const faviconUrl = absoluteAssetUrl(store.favicon, publicOrigin) ?? `${publicOrigin}/favicon.svg`;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": isProductPage ? "Product" : "TravelAgency",
    name: isProductPage ? product?.name : store.name,
    description,
    url: canonicalUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(isProductPage ? { brand: { "@type": "Brand", name: store.name } } : {}),
    ...(!isProductPage && absoluteAssetUrl(store.logo, publicOrigin)
      ? { logo: absoluteAssetUrl(store.logo, publicOrigin) }
      : {}),
  }).replace(/</g, "\\u003c");

  return {
    title,
    description,
    keywords,
    canonicalUrl,
    faviconUrl,
    imageUrl,
    imageAlt: imageUrl ? `Imagem de ${isProductPage ? product?.name : store.name}` : null,
    jsonLd,
  };
}

export function renderStorefrontMetadata(metadata: StorefrontMetadata): string {
  const tag = (attribute: "name" | "property", key: string, content: string, id: string) =>
    `<meta id="${id}" ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  const imageTags = metadata.imageUrl
    ? [
        tag("property", "og:image", metadata.imageUrl, "page-og-image"),
        tag("property", "og:image:alt", metadata.imageAlt ?? metadata.title, "page-og-image-alt"),
        tag("name", "twitter:image", metadata.imageUrl, "page-twitter-image"),
      ].join("\n    ")
    : "";

  return `<!-- VITRINE_METADATA_START -->
    <title id="page-title">${escapeHtml(metadata.title)}</title>
    ${tag("name", "description", metadata.description, "page-description")}
    ${tag("name", "keywords", metadata.keywords, "page-keywords")}
    ${tag("name", "category", "Agência de viagens", "page-category")}
    <link id="page-canonical" rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />
    <link id="page-favicon" rel="icon" href="${escapeHtml(metadata.faviconUrl)}" />
    ${tag("property", "og:type", "website", "page-og-type")}
    ${tag("property", "og:site_name", metadata.title, "page-og-site-name")}
    ${tag("property", "og:title", metadata.title, "page-og-title")}
    ${tag("property", "og:description", metadata.description, "page-og-description")}
    ${tag("property", "og:url", metadata.canonicalUrl, "page-og-url")}
    ${imageTags}
    ${tag("name", "twitter:card", metadata.imageUrl ? "summary_large_image" : "summary", "page-twitter-card")}
    ${tag("name", "twitter:title", metadata.title, "page-twitter-title")}
    ${tag("name", "twitter:description", metadata.description, "page-twitter-description")}
    <script id="storefront-structured-data" type="application/ld+json">${metadata.jsonLd}</script>
    <!-- VITRINE_METADATA_END -->`;
}

export function injectStorefrontMetadata(html: string, metadata: StorefrontMetadata): string {
  return html.replace(
    /<!-- VITRINE_METADATA_START -->[\s\S]*?<!-- VITRINE_METADATA_END -->/,
    renderStorefrontMetadata(metadata),
  );
}