import { sql, type AnyColumn } from "drizzle-orm";

export const TRIP_TIMEZONE = "America/Sao_Paulo";
const TRIP_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/**
 * Keeps trip times as local wall-clock values. The database stores these
 * values separately from the calendar date, so they must never be parsed as
 * browser/server-local Date values.
 */
export function normalizeTripTime(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (!TRIP_TIME_PATTERN.test(normalized)) return null;
  return normalized.slice(0, 5);
}

export function isValidTripTime(value: string | null | undefined): boolean {
  return value == null || value.trim() === "" || normalizeTripTime(value) !== null;
}

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

export function formatTripCalendarDate(
  date: Date | string | null | undefined,
): string {
  if (!date) return "";
  const dateOnly = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00-03:00`)
    : date instanceof Date ? date : new Date(date);
  const parsed = dateOnly;
  if (Number.isNaN(parsed.getTime())) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TRIP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
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
  const normalizedTime = normalizeTripTime(time);
  const timePart = normalizedTime ? `${normalizedTime}:00` : "00:00:00";
  if (time && normalizedTime === null) return null;

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

  const dateLabel = formatTripCalendarDate(date);
  const normalizedTime = normalizeTripTime(time);
  return normalizedTime ? `${dateLabel} às ${normalizedTime}` : dateLabel;
}