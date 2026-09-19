const BRAZIL_TZ = "America/Sao_Paulo";

function timeWithSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/**
 * Parses a trip date and its optional time as a Brazil local datetime.
 *
 * Trip dates are stored as timestamp values at midday so the calendar date
 * survives the API round trip. When a time is supplied, it is the authoritative
 * time for the calendar date and must not be interpreted in the browser's
 * local timezone.
 */
export function parseTripDateTime(date: string, time?: string | null): Date {
  if (!time && date.length > 10) {
    return new Date(date);
  }

  const datePart = date.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return new Date(
      `${datePart}T${time ? timeWithSeconds(time) : "00:00:00"}-03:00`,
    );
  }

  return new Date(date);
}

function formatDatePart(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTimePart(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Formats a trip endpoint using the same date/time pair used for calculations.
 */
export function formatTripDateTime(
  date?: string | null,
  time?: string | null,
): string {
  if (!date) return "";
  const parsed = parseTripDateTime(date, time);
  if (Number.isNaN(parsed.getTime())) return date;
  const datePart = formatDatePart(parsed);
  return time ? `${datePart} às ${formatTimePart(parsed)}` : datePart;
}

export function formatTripDateRange(
  departureDate?: string | null,
  returnDate?: string | null,
  departureTime?: string | null,
  returnTime?: string | null,
): string {
  if (!departureDate) return "";
  const departure = formatTripDateTime(departureDate, departureTime);
  if (!returnDate) return departure;
  return `${departure} — ${formatTripDateTime(returnDate, returnTime)}`;
}

export function brazilCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}