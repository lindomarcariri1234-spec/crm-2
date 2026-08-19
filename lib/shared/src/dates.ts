const BRAZIL_TZ = "America/Sao_Paulo";

/**
 * Returns today's date as "YYYY-MM-DD" in the Brazil timezone (America/Sao_Paulo).
 *
 * ⚠️  NEVER use `new Date().toISOString().slice(0, 10)` as a substitute.
 *     toISOString() returns the UTC date, which can be *yesterday* in Brazil
 *     between 21:00 and 00:00 (UTC-3 offset). Always call localToday() instead.
 */
export function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Formats a date value to "dd/MM/yyyy" in the Brazil timezone.
 * Handles both:
 *   - Date-only strings ("YYYY-MM-DD"): parses as noon local time to avoid UTC midnight off-by-one
 *   - Full ISO timestamps ("YYYY-MM-DDTHH:mm:ssZ"): converts to Brazil time explicitly
 *   - Date objects: converts to Brazil time explicitly
 */
export function formatDateBR(value: string | Date | null | undefined): string {
  if (!value) return "";
  try {
    let d: Date;
    if (typeof value === "string") {
      d = value.length <= 10
        ? new Date(value + "T12:00:00")
        : new Date(value);
    } else {
      d = value;
    }
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: BRAZIL_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}
