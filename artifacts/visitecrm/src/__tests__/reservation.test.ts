import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/api-client-react", () => ({}));

import { CreateReservationBody, CreateTripBody } from "@workspace/api-zod";
import {
  computeReservationTotal,
  computeDetailedTotal,
  applyDiscount,
} from "../lib/reservationPricing.js";

describe("computeReservationTotal — adult price × seat count", () => {
  it("returns 0 when there are no seats", () => {
    expect(computeReservationTotal(150, [])).toBe(0);
  });

  it("returns price per seat for a single seat", () => {
    expect(computeReservationTotal(150, ["1A"])).toBe(150);
  });

  it("multiplies price by number of seats", () => {
    expect(computeReservationTotal(150, ["1A", "2B", "3C"])).toBe(450);
  });

  it("handles fractional prices correctly", () => {
    expect(computeReservationTotal(99.9, ["1A", "2B"])).toBeCloseTo(199.8, 5);
  });

  it("handles zero price per seat", () => {
    expect(computeReservationTotal(0, ["1A", "2B"])).toBe(0);
  });
});

describe("computeDetailedTotal — adult/child/senior pricing", () => {
  it("calculates adult-only total", () => {
    expect(
      computeDetailedTotal({ priceAdult: 200, adultSeats: ["1A", "2B"] }),
    ).toBe(400);
  });

  it("calculates adult + child total with separate prices", () => {
    expect(
      computeDetailedTotal({
        priceAdult: 200,
        adultSeats: ["1A", "2B"],
        priceChild: 100,
        childSeats: ["3C"],
      }),
    ).toBe(500);
  });

  it("calculates adult + senior total with separate prices", () => {
    expect(
      computeDetailedTotal({
        priceAdult: 200,
        adultSeats: ["1A"],
        priceSenior: 150,
        seniorSeats: ["2B", "3C"],
      }),
    ).toBe(500);
  });

  it("falls back to adult price for children when priceChild is null", () => {
    expect(
      computeDetailedTotal({
        priceAdult: 200,
        adultSeats: ["1A"],
        priceChild: null,
        childSeats: ["2B"],
      }),
    ).toBe(400);
  });

  it("returns 0 when all seat lists are empty", () => {
    expect(
      computeDetailedTotal({
        priceAdult: 200,
        adultSeats: [],
        priceChild: 100,
        childSeats: [],
      }),
    ).toBe(0);
  });
});

describe("applyDiscount — final value after discount", () => {
  it("returns full totalValue when discount is zero", () => {
    expect(applyDiscount(1000, 0)).toBe(1000);
  });

  it("returns zero when discount equals total value", () => {
    expect(applyDiscount(500, 500)).toBe(0);
  });

  it("clamps negative results to zero (discount exceeds total)", () => {
    expect(applyDiscount(100, 200)).toBe(0);
  });

  it("correctly reduces the value by a partial discount", () => {
    expect(applyDiscount(800, 150)).toBe(650);
  });
});

describe("CreateReservationBody — Zod schema validation", () => {
  const validBody = {
    tripId: "trip-123",
    clientId: "client-456",
    seats: ["1A", "2B"],
    totalValue: 300,
  };

  it("accepts a minimal valid reservation body", () => {
    const result = CreateReservationBody.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("rejects when tripId is missing", () => {
    const { tripId: _, ...body } = validBody;
    const result = CreateReservationBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects when clientId is missing", () => {
    const { clientId: _, ...body } = validBody;
    const result = CreateReservationBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects when totalValue is not a number", () => {
    const result = CreateReservationBody.safeParse({ ...validBody, totalValue: "300" });
    expect(result.success).toBe(false);
  });

  it("rejects when seats is not an array", () => {
    const result = CreateReservationBody.safeParse({ ...validBody, seats: "1A,2B" });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields like paidValue and notes", () => {
    const result = CreateReservationBody.safeParse({
      ...validBody,
      paidValue: 100,
      notes: "Pagamento parcial",
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateTripBody — Zod schema validation", () => {
  const validTrip = {
    name: "Excursão ao Nordeste",
    destination: "Fortaleza, CE",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: "2025-07-10",
    totalCapacity: 46,
    priceAdult: 350,
  };

  it("accepts a valid trip body", () => {
    const result = CreateTripBody.safeParse(validTrip);
    expect(result.success).toBe(true);
  });

  it("rejects when name is missing", () => {
    const { name: _, ...body } = validTrip;
    const result = CreateTripBody.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects when priceAdult is not a number", () => {
    const result = CreateTripBody.safeParse({ ...validTrip, priceAdult: "350" });
    expect(result.success).toBe(false);
  });

  it("rejects when totalCapacity is not a number", () => {
    const result = CreateTripBody.safeParse({ ...validTrip, totalCapacity: "46" });
    expect(result.success).toBe(false);
  });

  it("accepts optional priceChild and priceSenior fields", () => {
    const result = CreateTripBody.safeParse({
      ...validTrip,
      priceChild: 200,
      priceSenior: 280,
    });
    expect(result.success).toBe(true);
  });
});
