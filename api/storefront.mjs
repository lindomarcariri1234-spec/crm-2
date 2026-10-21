import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_API_ORIGIN =
  process.env["STOREFRONT_API_ORIGIN"]?.trim() ||
  "https://crm-2-lindomarcariri.replit.app";
const PUBLIC_SITE_ORIGIN = "https://visitecrm.com";
const FALLBACK_DESCRIPTION = "Conheça nossas viagens, pacotes e experiências.";

function compactText(value, fallback, maxLength) {
  const text = typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "";
  return (text || fallback).slice(0, maxLength);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function absoluteAssetUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, PUBLIC_SITE_ORIGIN);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function storefrontOrigin(store) {
  const customDomain = typeof store.customDomain === "string"
    ? store.customDomain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase()
    : "";
  const requestHost = typeof store.requestHost === "string"
    ? store.requestHost.split(":")[0]?.toLowerCase()
    : "";
  if (store.domainVerified === true && customDomain && customDomain === requestHost) {
    return `https://${customDomain}`;
  }
  return PUBLIC_SITE_ORIGIN;
}

async function readStorefrontIndex() {
  const candidates = [
    path.join(process.cwd(), "artifacts/visitecrm/dist/public/index.html"),
    path.join(process.cwd(), "artifacts/visitecrm/public/index.html"),
    path.join(process.cwd(), "public/index.html"),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Vercel's output location differs between build and runtime bundles.
    }
  }

  throw new Error("STOREFRONT_INDEX_NOT_FOUND");
}

function renderMetadata(store, pathname) {
  const title = compactText(store.metaTitle, store.name || "Agência de viagens", 120);
  const description = compactText(
    store.metaDescription,
    store.tagline || store.description || FALLBACK_DESCRIPTION,
    180,
  );
  const keywords = compactText(
    store.metaKeywords,
    `${store.name || "agência de viagens"}, turismo, viagens, pacotes`,
    400,
  );
  const imageUrl = absoluteAssetUrl(
    store.bannerHome || store.bannerMobile || store.logo,
  );
  const faviconUrl = absoluteAssetUrl(store.favicon) || `${PUBLIC_SITE_ORIGIN}/favicon.svg`;
  const canonicalUrl = new URL(pathname, storefrontOrigin(store)).toString();
  const tag = (attribute, key, content, id) =>
    `<meta id="${id}" ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  const imageTags = imageUrl
    ? [
        tag("property", "og:image", imageUrl, "page-og-image"),
        tag("property", "og:image:alt", store.name || title, "page-og-image-alt"),
        tag("name", "twitter:image", imageUrl, "page-twitter-image"),
      ].join("\n    ")
    : "";
  const address = store.address || store.city || store.state
    ? {
        "@type": "PostalAddress",
        ...(store.address ? { streetAddress: store.address } : {}),
        ...(store.city ? { addressLocality: store.city } : {}),
        ...(store.state ? { addressRegion: store.state } : {}),
      }
    : undefined;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    name: store.name || title,
    description,
    url: canonicalUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
    ...(absoluteAssetUrl(store.logo) ? { logo: absoluteAssetUrl(store.logo) } : {}),
    ...(store.phone ? { telephone: store.phone } : {}),
    ...(store.email ? { email: store.email } : {}),
    ...(address ? { address } : {}),
  }).replace(/</g, "\\u003c");

  return `<!-- VITRINE_METADATA_START -->
    <title id="page-title">${escapeHtml(title)}</title>
    ${tag("name", "description", description, "page-description")}
    ${tag("name", "keywords", keywords, "page-keywords")}
    ${tag("name", "category", "Agência de viagens", "page-category")}
    <link id="page-canonical" rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <link id="page-favicon" rel="icon" href="${escapeHtml(faviconUrl)}" />
    ${tag("property", "og:type", "website", "page-og-type")}
    ${tag("property", "og:site_name", store.name || title, "page-og-site-name")}
    ${tag("property", "og:title", title, "page-og-title")}
    ${tag("property", "og:description", description, "page-og-description")}
    ${tag("property", "og:url", canonicalUrl, "page-og-url")}
    ${imageTags}
    ${tag("name", "twitter:card", imageUrl ? "summary_large_image" : "summary", "page-twitter-card")}
    ${tag("name", "twitter:title", title, "page-twitter-title")}
    ${tag("name", "twitter:description", description, "page-twitter-description")}
    <script id="storefront-structured-data" type="application/ld+json">${structuredData}</script>
    <!-- VITRINE_METADATA_END -->`;
}

function storefrontPath(url) {
  const slug = url.searchParams.get("store_slug")?.trim();
  if (!slug) return null;
  const rest = url.searchParams.get("store_path")?.trim().replace(/^\/+|\/+$/g, "");
  return `/loja/${encodeURIComponent(slug)}${rest ? `/${rest}` : ""}`;
}

export function createStorefrontHandler({
  fetchImpl = fetch,
  readIndex = readStorefrontIndex,
} = {}) {
  return async function storefrontHandler(request, response) {
    try {
      const requestUrl = new URL(request.url || "/", "https://vercel.internal");
      const pathname = storefrontPath(requestUrl);
      const slug = requestUrl.searchParams.get("store_slug")?.trim();
      if (!pathname || !slug) {
        response.statusCode = 400;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ error: "STORE_SLUG_REQUIRED" }));
        return;
      }

      const apiUrl = `${PUBLIC_API_ORIGIN.replace(/\/$/, "")}/api/public/store/${encodeURIComponent(slug)}`;
      const storeResponse = await fetchImpl(apiUrl, {
        headers: { accept: "application/json", "user-agent": "VisiteCRM storefront metadata" },
      });
      if (!storeResponse.ok) {
        response.statusCode = storeResponse.status === 404 ? 404 : 502;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ error: "STORE_METADATA_UNAVAILABLE" }));
        return;
      }

      const store = await storeResponse.json();
      store.requestHost = request.headers?.host ?? request.headers?.get?.("host") ?? "";
      const html = await readIndex();
      const rendered = html.replace(
        /<!-- VITRINE_METADATA_START -->[\s\S]*?<!-- VITRINE_METADATA_END -->/,
        renderMetadata(store, pathname),
      );

      response.statusCode = 200;
      response.setHeader("cache-control", "no-store, max-age=0");
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(rendered);
    } catch (error) {
      console.error("[storefront] metadata handler failed", error);
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "STOREFRONT_METADATA_FAILED" }));
    }
  };
}

export default createStorefrontHandler();