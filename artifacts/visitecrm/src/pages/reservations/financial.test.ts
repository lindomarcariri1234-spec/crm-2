import { describe, expect, it } from "vitest";
import { getReservationFinancialSummary, type ReservationWithFinancialLinks } from "./financial";

function makeReservation(overrides: Partial<ReservationWithFinancialLinks> = {}): ReservationWithFinancialLinks {
  return {
    id: "reservation-1",
    tripId: "trip-1",
    clientId: "client-1",
    seats: ["1"],
    hasInsurance: false,
    isGratuidade: false,
    totalValue: 189.05,
    paidValue: 169,
    balance: 20.05,
    installments: 1,
    status: "confirmed",
    voucherCode: "VOUCHER-1",
    qrCode: "qr",
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    trip: {
      id: "trip-1",
      name: "Viagem",
      destination: "Destino",
      departureDate: "2026-10-01T12:00:00.000Z",
      availableSeats: 10,
      totalCapacity: 20,
      status: "active",
    },
    client: {
      id: "client-1",
      name: "Cliente",
      email: "cliente@example.com",
      whatsapp: "5511999999999",
    },
    discountTotal: 9.95,
    ...overrides,
  };
}

describe("getReservationFinancialSummary", () => {
  it("calculates exact cents for a one-reservation order", () => {
    const summary = getReservationFinancialSummary(makeReservation({
      linkedOrder: {
        id: "order-1",
        orderNumber: "ORD-1",
        status: "confirmed",
        paymentStatus: "partial",
        subtotal: 199,
        discountAmount: 9.95,
        totalAmount: 189.05,
        depositAmount: 30,
        paidAmount: 169,
        amountRemaining: 20.05,
        paymentMethod: "pix",
        installments: 1,
      },
      linkedReservations: [{
        id: "reservation-1",
        reservationNumber: "RES-1",
        tripId: "trip-1",
        status: "confirmed",
        totalValue: 189.05,
        paidValue: 169,
        balance: 20.05,
        seats: ["1"],
        passengerCount: 1,
      }],
    }));

    expect(summary).toMatchObject({
      subtotal: 199,
      discount: 9.95,
      total: 189.05,
      paid: 169,
      balance: 20.05,
      paymentMethod: "pix",
      installments: 1,
      usesOrderTotals: true,
    });
  });

  it("does not duplicate a mixed order total in each reservation row", () => {
    const summary = getReservationFinancialSummary(makeReservation({
      linkedOrder: {
        id: "order-1",
        orderNumber: "ORD-1",
        status: "confirmed",
        paymentStatus: "partial",
        subtotal: 398,
        discountAmount: 19.9,
        totalAmount: 378.1,
        depositAmount: 30,
        paidAmount: 169,
        amountRemaining: 209.1,
        paymentMethod: "credit_card",
        installments: 2,
      },
      linkedReservations: [
        {
          id: "reservation-1",
          reservationNumber: "RES-1",
          tripId: "trip-1",
          status: "confirmed",
          totalValue: 189.05,
          paidValue: 169,
          balance: 20.05,
          seats: ["1"],
          passengerCount: 1,
        },
        {
          id: "reservation-2",
          reservationNumber: "RES-2",
          tripId: "trip-2",
          status: "confirmed",
          totalValue: 189.05,
          paidValue: 0,
          balance: 189.05,
          seats: ["2"],
          passengerCount: 1,
        },
      ],
    }));

    expect(summary).toMatchObject({
      subtotal: 199,
      discount: 9.95,
      total: 189.05,
      paid: 169,
      balance: 20.05,
      usesOrderTotals: false,
    });
  });
});