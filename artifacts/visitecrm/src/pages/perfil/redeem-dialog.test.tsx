// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RESERVATION_STATUS } from "@workspace/permissions";
import type { ClientPortalProfile } from "@/lib/clientPortalApi";
import { cleanupRoots, renderComponent } from "../../__tests__/eventSourceHarness";
import { ReservasTab } from "./index";

afterEach(cleanupRoots);

describe("reservation redemption", () => {
  it("opens a focus-managed dialog by keyboard and closes with Escape", async () => {
    const profile = {
      reservations: [{
        id: "reservation-1",
        tripName: "Viagem",
        tripDestination: "Cariri",
        tripDepartureDate: "2030-01-01",
        status: RESERVATION_STATUS.CONFIRMED,
        voucherCode: "ABC",
        seatsCount: 1,
        financialSummary: { amountRemaining: 100, totalAmount: 100, reservationValid: false },
      }],
      loyalty: { availablePoints: 100, minRedeemPoints: 10, realPerPoint: 1 },
    } as unknown as ClientPortalProfile;
    await renderComponent(createElement(ReservasTab, { profile, loyalty: profile.loyalty }));
    const trigger = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Usar pontos"));
    expect(trigger).toBeDefined();
    await act(async () => {
      trigger!.focus();
      trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      trigger!.click();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Usar pontos nesta reserva");
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(document.activeElement).toBe(trigger);
  });
});