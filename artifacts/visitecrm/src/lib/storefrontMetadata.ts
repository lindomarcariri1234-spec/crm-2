import { PublicStore, StoreProduct } from "./storeApi";
import { formatCurrency } from "./utils";

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

function validTime(value: string | Date | null | undefined): number | null | undefined {
  if (!value) return undefined;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function activeProductPrice(
  product: Pick<StoreProduct, "price" | "onSale" | "salePrice" | "saleStartsAt" | "saleEndsAt">,
  now = Date.now(),
): number | null {
  const basePrice = Number(product.price);
  if (!Number.isFinite(basePrice) || basePrice <= 0) return null;

  if (product.onSale && product.salePrice != null) {
    const salePrice = Number(product.salePrice);
    const startsAt = validTime(product.saleStartsAt);
    const endsAt = validTime(product.saleEndsAt);
    const saleWindowIsValid =
      startsAt !== null
      && endsAt !== null
      && (startsAt === undefined || startsAt <= now)
      && (endsAt === undefined || endsAt > now);
    if (saleWindowIsValid && Number.isFinite(salePrice) && salePrice > 0) {
      return salePrice;
    }
  }

  return basePrice;
}

function upcomingDepartureLabel(value: string | null | undefined, now = new Date()): string | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return null;

  const dateKeyFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });
  if (dateKeyFormatter.format(date) < dateKeyFormatter.format(now)) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function withProductDetails(description: string, details: string[]): string {
  const suffix = details.length > 0 ? ` ${details.join(" · ")}` : "";
  if (!suffix) return description;
  const availableDescriptionLength = 180 - suffix.length;
  if (availableDescriptionLength < 20) return suffix.trim().slice(0, 180);
  return `${description.slice(0, availableDescriptionLength).trim()}${suffix}`;
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
    | "metaTitle" | "metaDescription" | "metaKeywords" | "price" | "onSale" | "salePrice"
    | "saleStartsAt" | "saleEndsAt" | "startDate" | "departureDate"
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
  const departureLabel = isProductPage
    ? upcomingDepartureLabel(product?.departureDate) ?? upcomingDepartureLabel(product?.startDate)
    : null;
  const price = isProductPage && product ? activeProductPrice(product) : null;
  const descriptionWithProductDetails = isProductPage
    ? withProductDetails(
      description,
      [
        departureLabel ? `Saída em ${departureLabel}` : null,
        price ? `A partir de ${formatCurrency(price)}` : null,
      ].filter((detail): detail is string => Boolean(detail)),
    )
    : description;
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
  setMeta("page-description", "name", "description", descriptionWithProductDetails);
  setMeta("page-keywords", "name", "keywords", keywords);
  setMeta("page-category", "name", "category", "Agência de viagens");
  setLink("page-canonical", "canonical", canonicalUrl);
  setLink("page-favicon", "icon", faviconUrl);
  setMeta("page-og-type", "property", "og:type", "website");
  setMeta("page-og-site-name", "property", "og:site_name", title);
  setMeta("page-og-title", "property", "og:title", title);
  setMeta("page-og-description", "property", "og:description", descriptionWithProductDetails);
  setMeta("page-og-url", "property", "og:url", canonicalUrl);
  setMeta("page-og-image", "property", "og:image", imageUrl);
  setMeta("page-og-image-alt", "property", "og:image:alt", imageUrl ? `Imagem de ${isProductPage ? product?.name : store.name}` : null);
  setMeta("page-twitter-card", "name", "twitter:card", imageUrl ? "summary_large_image" : "summary");
  setMeta("page-twitter-title", "name", "twitter:title", title);
  setMeta("page-twitter-description", "name", "twitter:description", descriptionWithProductDetails);
  setMeta("page-twitter-image", "name", "twitter:image", imageUrl);

  const structuredData = document.getElementById("storefront-structured-data");
  if (structuredData) {
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": isProductPage ? "Product" : "TravelAgency",
      name: isProductPage ? product?.name : store.name,
      description: descriptionWithProductDetails,
      url: canonicalUrl,
      ...(imageUrl ? { image: imageUrl } : {}),
      ...(isProductPage ? { brand: { "@type": "Brand", name: store.name } } : {}),
      ...(!isProductPage && absoluteUrl(store.logoUrl) ? { logo: absoluteUrl(store.logoUrl) } : {}),
    }).replace(/</g, "\\u003c");
  }

  return restoreDefaultMetadata;
}