import { describe, expect, it } from "vitest";
import { getPassengerExportFinancialValues } from "./passenger-export";

describe("passenger export financial values", () => {
  it("emits a discounted multi-passenger reservation only once", () => {
    const emittedReservationIds = new Set<string>();

    const firstPassenger = getPassengerExportFinancialValues(
      "reservation-1",
      220,
      20,
      emittedReservationIds,
    );
    const secondPassenger = getPassengerExportFinancialValues(
      "reservation-1",
      220,
      20,
      emittedReservationIds,
    );

    expect(firstPassenger).toEqual(["220.00", "240.00", "20.00"]);
    expect(secondPassenger).toEqual(["", "", ""]);
    expect(emittedReservationIds.size).toBe(1);
  });

  it("exports the same base and total for a reservation without a discount", () => {
    expect(
      getPassengerExportFinancialValues("reservation-2", 100, 0, new Set<string>()),
    ).toEqual(["100.00", "100.00", "0.00"]);
  });
});