import { parseISO } from "date-fns";
import { calculateTripDuration } from "@/lib/tripDuration";
import type { Trip } from "@workspace/api-client-react";

export { formatCurrency, formatDate, formatCpf } from "@/lib/utils";

export function getCountdownLabel(date: string) {
  try {
    const target = parseISO(date);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    if (diffMs < 0) return "Encerrado";
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (hours < 1) return "Em breve";
    if (hours < 24) return `${hours} horas`;
    if (days === 1) return "Amanhã";
    if (days < 14) return `${days} dias`;
    return `${Math.round(days / 7)} semanas`;
  } catch {
    return "";
  }
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateProductSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    + "-" + Math.random().toString(36).slice(2, 7);
}

export function buildTripProductPayload(trip: Trip) {
  const t = trip as unknown as Record<string, unknown>;
  const images = [
    ...(trip.coverImage ? [trip.coverImage] : []),
    ...(Array.isArray(trip.gallery) ? trip.gallery : []),
  ];

  let durationDays: number | undefined;
  let durationNights: number | undefined;
  if (trip.departureDate && trip.returnDate) {
    const dur = calculateTripDuration(
      trip.departureDate,
      trip.returnDate,
      trip.departureTime ?? null,
      trip.returnTime ?? null,
    );
    if (dur && dur.totalMinutes > 0) {
      durationDays = dur.days;
      durationNights = dur.days > 0 ? dur.days - 1 : 0;
    }
  }

  const shortDescription = (typeof t.shortDescription === "string" && t.shortDescription)
    ? stripHtml(t.shortDescription)
    : (trip.description ? stripHtml(trip.description).slice(0, 200) : undefined);

  const metaTitle = (typeof t.metaTitle === "string" && t.metaTitle)
    ? t.metaTitle
    : trip.name;

  const metaDescription = (typeof t.metaDescription === "string" && t.metaDescription)
    ? stripHtml(t.metaDescription)
    : (trip.description ? stripHtml(trip.description).slice(0, 160) : undefined);

  const country = (typeof t.destinationCountry === "string" && t.destinationCountry)
    ? t.destinationCountry
    : "Brasil";

  return {
    name: trip.name,
    shortDescription,
    description: trip.description ?? "",
    type: trip.type,
    price: String(trip.priceAdult),
    thumbnail: trip.coverImage || undefined,
    images: images.length > 0 ? images : undefined,
    gallery: trip.gallery?.length > 0 ? trip.gallery : undefined,
    destination: `${trip.destinationCity}, ${trip.destinationState}`,
    productCity: trip.destinationCity,
    productState: trip.destinationState,
    country,
    hasDates: true,
    startDate: trip.departureDate,
    endDate: trip.returnDate ?? undefined,
    originCity: trip.originCity || undefined,
    originState: trip.originState || undefined,
    departureTime: trip.departureTime || undefined,
    returnTime: trip.returnTime || undefined,
    durationDays,
    durationNights,
    includes: trip.inclusions?.length > 0 ? trip.inclusions : undefined,
    excludes: trip.exclusions?.length > 0 ? trip.exclusions : undefined,
    trackInventory: true,
    stockQuantity: trip.availableSeats,
    isFeatured: trip.isFeatured,
    metaTitle,
    metaDescription,
    status: "active" as const,
  };
}
