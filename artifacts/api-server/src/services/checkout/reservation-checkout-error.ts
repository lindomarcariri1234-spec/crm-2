import { AppError } from "../../lib/errors";

const CUSTOMER_SAFE_RESERVATION_ERROR_CODES = new Set([
  "ACCOMMODATION_NO_AVAILABILITY",
  "ACCOMMODATION_NOT_AVAILABLE",
  "ACCOMMODATION_CHECK_IN_REQUIRED",
  "ACCOMMODATION_PERIOD_REQUIRED",
  "DUPLICATE_SEATS",
  "INSUFFICIENT_SEATS",
  "INVALID_SEAT_SELECTION",
  "INVALID_SEATS",
  "PASSENGER_NAME_REQUIRED",
  "PASSENGER_QUANTITY_MISMATCH",
  "PASSENGER_ASSIGNMENT_UNSUPPORTED",
  "RESERVATION_NO_AGENCY_USER",
  "SEAT_CONFLICT",
  "SEAT_MAP_DISABLED",
  "SEAT_QUANTITY_MISMATCH",
  "TRIP_NOT_FOUND",
]);

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function safeString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

export function toCustomerSafeReservationError(error: unknown): AppError | null {
  if (
    !(error instanceof AppError)
    || !error.isOperational
    || !CUSTOMER_SAFE_RESERVATION_ERROR_CODES.has(error.code)
  ) {
    return null;
  }

  // Do not forward arbitrary `extra` payloads from lower layers to the public
  // checkout response. The known error message and code are intentionally safe.
  return new AppError(error.message, error.statusCode, error.code);
}

export function getReservationFailureDiagnostic(error: unknown): Record<string, string> {
  const diagnostic: Record<string, string> = {
    failureStage: "create_reservations",
    errorName: "UnknownError",
  };
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    if (typeof current !== "object") break;
    seen.add(current);

    const item = current as Record<string, unknown>;
    if (depth === 0 && typeof item.name === "string") {
      diagnostic.errorName =
        item.name.length <= 64 && /^[A-Za-z][A-Za-z0-9_]*$/.test(item.name)
          ? item.name
          : "Error";
    }

    if (current instanceof AppError) {
      const code = safeString(current.code, SAFE_ERROR_CODE);
      if (code) diagnostic.applicationCode = code;
    }

    const sqlState = safeString(item.code, /^[0-9A-Z]{5}$/);
    if (sqlState && !diagnostic.sqlState) diagnostic.sqlState = sqlState;

    const constraint = safeString(item.constraint, SAFE_SQL_IDENTIFIER);
    if (constraint && !diagnostic.constraint) diagnostic.constraint = constraint;

    const table = safeString(item.table, SAFE_SQL_IDENTIFIER);
    if (table && !diagnostic.table) diagnostic.table = table;

    current = item.cause;
  }

  return diagnostic;
}
