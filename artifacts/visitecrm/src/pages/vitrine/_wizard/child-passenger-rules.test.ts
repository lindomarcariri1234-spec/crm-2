import { describe, expect, it } from "vitest";
import {
  getLapChildCount,
  getPaidSeatQuantity,
  getSeatedChildCount,
  getChildTicketPrice,
  calculateChildAwareSubtotal,
  hasCompleteChildPassengerData,
  type CoPassenger,
} from "./child-passenger-rules";

const child = (overrides: Partial<CoPassenger> = {}): CoPassenger => ({
  name: "Criança",
  cpf: "",
  phone: "",
  isChildUnder7: false,
  occupiesSeat: true,
  ...overrides,
});

describe("child passenger checkout rules", () => {
  it("charges a seat for the primary passenger and each child occupying a seat", () => {
    const children = [
      child(),
      child({ name: "Bebê", isChildUnder7: true, occupiesSeat: false }),
      child({ name: "Criança com poltrona", isChildUnder7: true }),
    ];

    expect(getPaidSeatQuantity(children)).toBe(3);
    expect(getSeatedChildCount(children)).toBe(2);
    expect(getLapChildCount(children)).toBe(1);
  });

  it("requires names for every child and prevents children aged 7+ from travelling without a seat", () => {
    expect(hasCompleteChildPassengerData([child({ name: " " })])).toBe(false);
    expect(hasCompleteChildPassengerData([
      child({ isChildUnder7: false, occupiesSeat: false }),
    ])).toBe(false);
  });

  it("allows a child under 7 to travel on a lap or in a paid seat", () => {
    expect(hasCompleteChildPassengerData([
      child({ isChildUnder7: true, occupiesSeat: false }),
      child({ name: "Criança sentada", isChildUnder7: true, occupiesSeat: true }),
    ])).toBe(true);
  });

  it("uses the configured child fare for seated children and falls back only when it is absent", () => {
    expect(getChildTicketPrice(599, "300")).toBe(300);
    expect(getChildTicketPrice(599, null)).toBe(599);
    expect(getChildTicketPrice(599, 0)).toBe(0);
  });

  it("calculates subtotal with the adult buyer fare and each seated child's fare", () => {
    expect(calculateChildAwareSubtotal(599, 300, 2)).toBe(1199);
  });
});
