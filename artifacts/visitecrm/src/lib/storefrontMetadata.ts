import { PublicStore, StoreProduct } from "./storeApi";

const DEFAULT_TITLE = "VisiteCRM — CRM para Agências de Viagem";
const DEFAULT_DESCRIPTION =
  "VisiteCRM é o CRM completo para agências de viagem brasileiras. Gerencie reservas, clientes, comissões e programas de indicação em um só lugar.";
const DEFAULT_KEYWORDS = "CRM, agências de viagem, turismo, reservas";

function text(value: string | null | undefined, fallback: string, maxLength: number): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function plainText(value: string | null | undefined): string | null | undefined {
  return value?.replace(/<[^>]*>/g, " ");
}

function firstImage(...values: Array<string | null | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
}

function absoluteUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function setMeta(id: string, attribute: "name" | "property", key: string, content: string | null): void {
  let element = document.getElementById(id) as HTMLMetaElement | null;
  if (!content) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("meta");
    element.id = id;
    document.head.appendChild(element);
  }
  element.setAttribute(attribute, key);
  element.content = content;
}

function setLink(id: string, rel: string, href: string): void {
  let element = document.getElementById(id) as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.id = id;
    document.head.appendChild(element);
  }
  element.rel = rel;
  element.href = href;
}

function restoreDefaultMetadata(): void {
  document.title = DEFAULT_TITLE;
  setMeta("page-description", "name", "description", DEFAULT_DESCRIPTION);
  setMeta("page-keywords", "name", "keywords", DEFAULT_KEYWORDS);
  setMeta("page-category", "name", "category", null);
  setLink("page-canonical", "canonical", `${window.location.origin}/`);
  setLink("page-favicon", "icon", `${window.location.origin}/favicon.svg`);
  setMeta("page-og-type", "property", "og:type", "website");
  setMeta("page-og-site-name", "property", "og:site_name", DEFAULT_TITLE);
  setMeta("page-og-title", "property", "og:title", DEFAULT_TITLE);
  setMeta("page-og-description", "property", "og:description", DEFAULT_DESCRIPTION);
  setMeta("page-og-url", "property", "og:url", `${window.location.origin}/`);
  setMeta("page-og-image", "property", "og:image", null);
  setMeta("page-og-image-alt", "property", "og:image:alt", null);
  setMeta("page-twitter-card", "name", "twitter:card", "summary");
  setMeta("page-twitter-title", "name", "twitter:title", DEFAULT_TITLE);
  setMeta("page-twitter-description", "name", "twitter:description", DEFAULT_DESCRIPTION);
  setMeta("page-twitter-image", "name", "twitter:image", null);
  document.getElementById("storefront-structured-data")?.replaceChildren();
}

export function applyStorefrontMetadata(
  store: PublicStore,
  pathname: string,
  product?: Pick<
    StoreProduct,
    "name" | "description" | "shortDescription" | "thumbnail" | "images" | "gallery"
    | "metaTitle" | "metaDescription" | "metaKeywords"
  > | null,
): () => void {
  const storeDescription = text(
    store.seoDescription,
    text(store.tagline, text(plainText(store.description), "Conheça nossas viagens, pacotes e experiências.", 180), 180),
    180,
  );
  const isProductPage = Boolean(product);
  const title = isProductPage
    ? text(product?.metaTitle, product?.name ?? store.name, 120)
    : text(store.seoTitle, store.name, 120);
  const description = isProductPage
    ? text(
      product?.metaDescription,
      text(product?.shortDescription, text(plainText(product?.description), storeDescription, 180), 180),
      180,
    )
    : storeDescription;
  const keywords = isProductPage
    ? text(product?.metaKeywords, `${product?.name ?? store.name}, ${store.seoKeywords ?? "agência de viagens, turismo, viagens, pacotes de viagem"}`, 400)
    : text(store.seoKeywords, `${store.name}, agência de viagens, turismo, viagens, pacotes de viagem`, 400);
  const canonicalUrl = new URL(pathname, window.location.origin).toString();
  const productImage = firstImage(
    product?.thumbnail,
    ...(product?.images ?? []),
    ...(product?.gallery ?? []),
  );
  const imageUrl = absoluteUrl(productImage ?? store.bannerUrl ?? store.bannerMobileUrl ?? store.logoUrl);
  const faviconUrl = absoluteUrl(store.faviconUrl) ?? `${window.location.origin}/favicon.svg`;

  document.title = title;
  setMeta("page-description", "name", "description", description);
  setMeta("page-keywords", "name", "keywords", keywords);
  setMeta("page-category", "name", "category", "Agência de viagens");
  setLink("page-canonical", "canonical", canonicalUrl);
  setLink("page-favicon", "icon", faviconUrl);
  setMeta("page-og-type", "property", "og:type", "website");
  setMeta("page-og-site-name", "property", "og:site_name", title);
  setMeta("page-og-title", "property", "og:title", title);
  setMeta("page-og-description", "property", "og:description", description);
  setMeta("page-og-url", "property", "og:url", canonicalUrl);
  setMeta("page-og-image", "property", "og:image", imageUrl);
  setMeta("page-og-image-alt", "property", "og:image:alt", imageUrl ? `Imagem de ${isProductPage ? product?.name : store.name}` : null);
  setMeta("page-twitter-card", "name", "twitter:card", imageUrl ? "summary_large_image" : "summary");
  setMeta("page-twitter-title", "name", "twitter:title", title);
  setMeta("page-twitter-description", "name", "twitter:description", description);
  setMeta("page-twitter-image", "name", "twitter:image", imageUrl);

  const structuredData = document.getElementById("storefront-structured-data");
  if (structuredData) {
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": isProductPage ? "Product" : "TravelAgency",
      name: isProductPage ? product?.name : store.name,
      description,
      url: canonicalUrl,
      ...(imageUrl ? { image: imageUrl } : {}),
      ...(isProductPage ? { brand: { "@type": "Brand", name: store.name } } : {}),
      ...(!isProductPage && absoluteUrl(store.logoUrl) ? { logo: absoluteUrl(store.logoUrl) } : {}),
    }).replace(/</g, "\\u003c");
  }

  return restoreDefaultMetadata;
}