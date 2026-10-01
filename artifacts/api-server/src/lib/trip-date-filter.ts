const BRAZIL_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Converts a YYYY-MM-DD calendar date in America/Sao_Paulo to its UTC start.
 * Trip departure dates are stored as timestamptz values, so comparing against
 * Brazil midnight keeps the date filter independent of the API server timezone.
 */
export function parseBrazilCalendarDateStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const calendarDate = new Date(utcMidnight);

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(utcMidnight + BRAZIL_UTC_OFFSET_MS);
}