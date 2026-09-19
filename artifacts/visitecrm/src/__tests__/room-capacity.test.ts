import { describe, expect, it } from "vitest";
import { formatRoomCapacityError, getRoomCapacityError } from "../lib/room-capacity.js";

const capacityPayload = {
  code: "ROOM_CAPACITY_EXCEEDED",
  roomId: "room-101",
  capacity: 2,
  occupied: 3,
  currentOccupied: 2,
  requestedCount: 1,
};

describe("room capacity error feedback", () => {
  it("formats the same feedback for direct and response.data error envelopes", () => {
    const directError = getRoomCapacityError({ data: capacityPayload });
    const responseError = getRoomCapacityError({ response: { data: capacityPayload } });

    expect(directError).not.toBeNull();
    expect(responseError).toEqual(directError);
    expect(formatRoomCapacityError(directError!, "Quarto 101")).toEqual(
      formatRoomCapacityError(responseError!, "Quarto 101"),
    );
  });

  it("uses occupied when currentOccupied is not returned", () => {
    const error = getRoomCapacityError({
      data: {
        ...capacityPayload,
        currentOccupied: undefined,
      },
    });

    expect(error).toEqual({
      roomId: "room-101",
      capacity: 2,
      occupied: 3,
      currentOccupied: 3,
      requestedCount: 1,
    });
    expect(formatRoomCapacityError(error!, "Quarto 101")).toEqual({
      title: "Quarto 101 sem vagas",
      description:
        "Capacidade: 2 pessoa(s). Ocupação atual: 3. Vagas disponíveis antes desta tentativa: 0.",
    });
  });

  it("ignores errors that are not room capacity failures", () => {
    expect(
      getRoomCapacityError({
        data: {
          ...capacityPayload,
          code: "VALIDATION_ERROR",
        },
      }),
    ).toBeNull();
    expect(
      getRoomCapacityError({
        response: {
          data: {
            message: "Não foi possível atualizar o quarto",
          },
        },
      }),
    ).toBeNull();
  });
});