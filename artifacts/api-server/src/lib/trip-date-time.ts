import { sql, type AnyColumn } from "drizzle-orm";

export const TRIP_TIMEZONE = "America/Sao_Paulo";

/**
 * Builds the actual departure instant from the calendar date and optional
 * local departure time stored on a trip.
 *
 * departureDate is persisted as a timestamp that preserves the Brazil
 * calendar date. Converting it to a Brazil date before adding departureTime
 * avoids depending on the database session timezone.
 */
export function tripDepartureAtSql(
  dateColumn: AnyColumn,
  timeColumn: AnyColumn,
) {
  return sql`(
    (
      (${dateColumn} AT TIME ZONE ${TRIP_TIMEZONE})::date
      + COALESCE(NULLIF(${timeColumn}, '')::time, time '00:00:00')
    ) AT TIME ZONE ${TRIP_TIMEZONE}
  )`;
}

function brazilDatePart(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Returns a trip's departure instant without using the server's local
 * timezone. Brazil has remained UTC-3 since DST was removed.
 */
export function parseTripDeparture(
  date: Date | string | null | undefined,
  time?: string | null,
): Date | null {
  if (!date) return null;
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const datePart = brazilDatePart(parsedDate);
  const normalizedTime = time?.trim() || "00:00:00";
  const timePart = /^\d{2}:\d{2}$/.test(normalizedTime)
    ? `${normalizedTime}:00`
    : normalizedTime;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timePart)) return null;

  const result = new Date(`${datePart}T${timePart}-03:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

export function formatTripDeparture(
  date: Date | string | null | undefined,
  time?: string | null,
): string {
  if (!date) return "";
  const parsed = parseTripDeparture(date, time);
  if (!parsed) return "";

  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TRIP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
  return time?.trim() ? `${dateLabel} às ${time.trim().slice(0, 5)}` : dateLabel;
}