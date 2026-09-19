import { parseTripDateTime } from "./tripDateTime";

export interface TripDuration {
  totalMinutes: number;
  days: number;
  hours: number;
  formatted: string;
  formattedShort: string;
}

export function calculateTripDuration(
  departureDate?: string | null,
  returnDate?: string | null,
  departureTime?: string | null,
  returnTime?: string | null,
): TripDuration | null {
  if (!departureDate || !returnDate) return null;

  const departure = parseTripDateTime(departureDate, departureTime);
  const returnDt = parseTripDateTime(returnDate, returnTime);
  if (Number.isNaN(departure.getTime()) || Number.isNaN(returnDt.getTime())) {
    return null;
  }

  const totalMinutes = Math.max(
    0,
    Math.round((returnDt.getTime() - departure.getTime()) / 60000),
  );
  if (totalMinutes === 0) return null;

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  let formatted: string;
  if (days === 0) {
    formatted = `${hours} hora${hours !== 1 ? "s" : ""}`;
  } else if (hours === 0) {
    formatted = `${days} dia${days !== 1 ? "s" : ""}`;
  } else {
    formatted = `${days} dia${days !== 1 ? "s" : ""} e ${hours} hora${hours !== 1 ? "s" : ""}`;
  }

  let formattedShort: string;
  if (days === 0) {
    formattedShort = `${hours}h`;
  } else if (hours === 0) {
    formattedShort = `${days}d`;
  } else {
    formattedShort = `${days}d ${hours}h`;
  }

  return { totalMinutes, days, hours, formatted, formattedShort };
}
