import { describe, expect, it } from "vitest";
import {
  buildTripWhatsAppBroadcastIdempotencyKey,
  selectTripWhatsAppBroadcastRecipients,
} from "@workspace/shared";

describe("selectTripWhatsAppBroadcastRecipients", () => {
  it("does not send free passengers when filtering confirmed or pending reservations", () => {
    const selection = selectTripWhatsAppBroadcastRecipients(
      "confirmed",
      [
        {
          reservationStatus: "confirmed",
          name: "Reserva confirmada",
          phones: [{ phone: "(11) 99999-0001" }],
        },
        {
          reservationStatus: "pending",
          name: "Reserva pendente",
          phones: [{ phone: "(11) 99999-0002" }],
        },
      ],
      [{ name: "Guia", phones: [{ phone: "(11) 99999-0003" }] }],
    );

    expect(selection.recipients).toEqual([
      {
        phone: "5511999990001",
        name: "Reserva confirmada",
        reference: "",
        boardingLocation: "",
      },
    ]);
    expect(selection.skipped).toBe(0);
  });

  it("uses the first valid number, deduplicates normalized phones, and includes free passengers only in all", () => {
    const selection = selectTripWhatsAppBroadcastRecipients(
      "all",
      [
        {
          reservationStatus: "confirmed",
          name: "Passageiro",
          phones: [
            { phone: "not a phone" },
            { phone: "+55 (11) 99999-0001", clientId: "client-1" },
          ],
          reference: "RES-1",
          boardingLocation: "Terminal",
        },
        {
          reservationStatus: "pending",
          name: "Contato duplicado",
          phones: [{ phone: "11 99999-0001" }],
        },
        {
          reservationStatus: "refunded",
          name: "Reserva reembolsada",
          phones: [{ phone: "11 99999-0002" }],
        },
      ],
      [
        { name: "Guia", phones: [{ phone: "5511999990001" }] },
        { name: "Organizador", phones: [{ phone: "11 98888-0003" }] },
      ],
    );

    expect(selection.recipients).toEqual([
      {
        phone: "5511999990001",
        recipientClientId: "client-1",
        name: "Passageiro",
        reference: "RES-1",
        boardingLocation: "Terminal",
      },
      {
        phone: "5511988880003",
        name: "Organizador",
        reference: "",
        boardingLocation: "",
      },
    ]);
    expect(selection.skipped).toBe(2);
  });

  it("falls back from an invalid passenger number to the booking client's valid contact", () => {
    const selection = selectTripWhatsAppBroadcastRecipients("pending", [
      {
        reservationStatus: "pending",
        name: "Passageiro",
        phones: [
          { phone: "123" },
          { phone: "(11) 98888-0004", clientId: "client-4" },
        ],
      },
    ]);

    expect(selection.recipients).toHaveLength(1);
    expect(selection.recipients[0]).toMatchObject({
      phone: "5511988880004",
      recipientClientId: "client-4",
    });
    expect(selection.skipped).toBe(0);
  });
});

describe("buildTripWhatsAppBroadcastIdempotencyKey", () => {
  it("replays one broadcast attempt but allows a later send to the same phone", () => {
    const first = buildTripWhatsAppBroadcastIdempotencyKey(
      "trip-1",
      "request-1",
      "5511999990001",
    );
    const replay = buildTripWhatsAppBroadcastIdempotencyKey(
      "trip-1",
      "request-1",
      "5511999990001",
    );
    const laterBroadcast = buildTripWhatsAppBroadcastIdempotencyKey(
      "trip-1",
      "request-2",
      "5511999990001",
    );

    expect(replay).toBe(first);
    expect(laterBroadcast).not.toBe(first);
  });
});
