import { localToday } from "@workspace/shared";

export interface FeaturedSelection<T extends { isFeatured?: boolean }> {
  products: T[];
  usesFallback: boolean;
}

export function selectFeaturedOrRealProducts<T extends { isFeatured?: boolean }>(
  products: T[],
  limit = 3,
): FeaturedSelection<T> {
  const featured = products.filter((product) => product.isFeatured);
  if (featured.length > 0) return { products: featured.slice(0, limit), usesFallback: false };
  return { products: products.slice(0, limit), usesFallback: products.length > 0 };
}

export function destinationSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function destinationPath(slug: string): string {
  return `/loja/visite-cariri/destinos/${slug}`;
}

export function findDestination<T extends { name: string }>(slug: string, destinations: T[]): T | undefined {
  return destinations.find((destination) => destinationSlug(destination.name) === slug);
}

export interface DatedTravelProduct {
  id: string;
  name: string;
  slug: string;
  departureDate?: string | null;
  startDate?: string | null;
}

export interface UpcomingDeparture<T extends DatedTravelProduct> {
  product: T;
  date: string;
}

function validDatePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function selectUpcomingDepartures<T extends DatedTravelProduct>(
  products: T[],
  today = localToday(),
): UpcomingDeparture<T>[] {
  const todayDate = validDatePart(today);
  if (!todayDate) return [];
  return products
    .flatMap((product) => {
      // Match the storefront's established departureDate ?? startDate convention.
      const date = validDatePart(product.departureDate ?? product.startDate);
      return date && date >= todayDate ? [{ product, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.product.name.localeCompare(b.product.name, "pt-BR"));
}
