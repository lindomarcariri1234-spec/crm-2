import { describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors.js";
import {
  getReservationFailureDiagnostic,
  toCustomerSafeReservationError,
} from "./reservation-checkout-error.js";

describe("reservation checkout error handling", () => {
  it("preserves allowlisted business errors without forwarding extra data", () => {
    const safeError = new AppError("Vaga indisponível.", 409, "SEAT_CONFLICT", {
      privateValue: "not for the customer",
    });

    const result = toCustomerSafeReservationError(safeError);

    expect(result).toMatchObject({
      message: "Vaga indisponível.",
      statusCode: 409,
      code: "SEAT_CONFLICT",
      extra: undefined,
    });
  });

  it("does not expose unexpected errors as checkout messages", () => {
    const result = toCustomerSafeReservationError(
      new Error("private database or customer detail"),
    );

    expect(result).toBeNull();
  });

  it("extracts safe database diagnostics without recording the raw message", () => {
    const databaseError = Object.assign(new Error("private customer data"), {
      code: "23503",
      constraint: "reservations_created_by_id_fkey",
      table: "reservations",
    });
    const wrappedError = Object.assign(new Error("wrapped private detail"), {
      cause: databaseError,
    });

    const diagnostic = getReservationFailureDiagnostic(wrappedError);

    expect(diagnostic).toEqual({
      failureStage: "create_reservations",
      errorName: "Error",
      sqlState: "23503",
      constraint: "reservations_created_by_id_fkey",
      table: "reservations",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private");
  });

  it("omits malformed database identifiers from diagnostics", () => {
    const databaseError = Object.assign(new Error("private"), {
      code: "23503",
      constraint: "customer@email.example",
      table: "reservations",
    });

    expect(getReservationFailureDiagnostic(databaseError)).toEqual({
      failureStage: "create_reservations",
      errorName: "Error",
      sqlState: "23503",
      table: "reservations",
    });
  });
});
