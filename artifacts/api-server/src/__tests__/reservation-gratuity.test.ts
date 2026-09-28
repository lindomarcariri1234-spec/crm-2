import { describe, expect, it } from "vitest";
import { calculateReservationGratuityTransition } from "../lib/reservation-gratuity.js";

describe("calculateReservationGratuityTransition", () => {
  it("waives the unpaid net amount while retaining it for restoration", () => {
    expect(calculateReservationGratuityTransition({
      isGratuidade: false,
      totalValue: "189.05",
      gratuityAmount: "0",
      paidValue: "0",
      balance: "189.05",
    }, true)).toEqual({
      isGratuidade: true,
      totalValue: 0,
      gratuityAmount: 189.05,
      balance: 0,
      action: "applied",
    });
  });

  it("restores the saved value and recalculates debt when gratuity is removed", () => {
    expect(calculateReservationGratuityTransition({
      isGratuidade: true,
      totalValue: "0",
      gratuityAmount: "189.05",
      paidValue: "25",
      balance: "0",
    }, false)).toEqual({
      isGratuidade: false,
      totalValue: 189.05,
      gratuityAmount: 0,
      balance: 164.05,
      action: "removed",
    });
  });

  it("is idempotent for an already-correct complimentary reservation", () => {
    expect(calculateReservationGratuityTransition({
      isGratuidade: true,
      totalValue: "0",
      gratuityAmount: "189.05",
      paidValue: "0",
      balance: "0",
    }, true)).toBeNull();
  });

  it("corrects a legacy complimentary reservation that still has a balance", () => {
    expect(calculateReservationGratuityTransition({
      isGratuidade: true,
      totalValue: "189.05",
      gratuityAmount: "0",
      paidValue: "0",
      balance: "189.05",
    }, true)).toMatchObject({
      totalValue: 0,
      gratuityAmount: 189.05,
      balance: 0,
      action: "applied",
    });
  });
});