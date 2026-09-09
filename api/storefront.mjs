import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_API_ORIGIN =
  process.env["STOREFRONT_API_ORIGIN"]?.trim() ||
  "https://crm-2-lindomarcariri.replit.app";
const PUBLIC_SITE_ORIGIN = "https://visitecrm.com";

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
  const title = compactText(store.metaTitle, store.name || "Agência de viagens", 200);
  const description = compactText(
    store.metaDescription,
    store.tagline || store.description || "Conheça nossas viagens, pacotes e experiências.",
    300,
  );
  const keywords = compactText(
    store.metaKeywords,
    `${store.name || "agência de viagens"}, turismo, viagens, pacotes`,
    400,
  );
  const imageUrl = absoluteAssetUrl(
    store.bannerHome || store.bannerMobile || store.logo,
  );
  const canonicalUrl = new URL(pathname, PUBLIC_SITE_ORIGIN).toString();
  const tag = (attribute, key, content, id) =>
    `<meta id="${id}" ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  const imageTags = imageUrl
    ? [
        tag("property", "og:image", imageUrl, "page-og-image"),
        tag("property", "og:image:alt", store.name || title, "page-og-image-alt"),
        tag("name", "twitter:image", imageUrl, "page-twitter-image"),
      ].join("\n    ")
    : "";

  return `<!-- VITRINE_METADATA_START -->
    <title id="page-title">${escapeHtml(title)}</title>
    ${tag("name", "description", description, "page-description")}
    ${tag("name", "keywords", keywords, "page-keywords")}
    <link id="page-canonical" rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    ${tag("property", "og:type", "website", "page-og-type")}
    ${tag("property", "og:site_name", store.name || title, "page-og-site-name")}
    ${tag("property", "og:title", title, "page-og-title")}
    ${tag("property", "og:description", description, "page-og-description")}
    ${tag("property", "og:url", canonicalUrl, "page-og-url")}
    ${imageTags}
    ${tag("name", "twitter:card", imageUrl ? "summary_large_image" : "summary", "page-twitter-card")}
    ${tag("name", "twitter:title", title, "page-twitter-title")}
    ${tag("name", "twitter:description", description, "page-twitter-description")}
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