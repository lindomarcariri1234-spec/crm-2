import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockToast = vi.hoisted(() => vi.fn());
const mockUpdateAssignments = vi.hoisted(() => vi.fn());
const mockGetRoomAssignments = vi.hoisted(() => vi.fn());
const mockRoomData = vi.hoisted(() => ({
  accommodation: { name: "Pousada do Cariri" },
  rooms: [
    { id: "room-full", name: "Quarto 101", category: "standard", capacity: 2, available: 1, occupied: 1, status: "active" },
    { id: "room-other", name: "Quarto 102", category: "standard", capacity: 3, available: 3, occupied: 0, status: "active" },
  ],
  assignments: [{ passengerId: "passenger-1", roomId: "room-full" }],
  allocationSummary: { nights: 1, rows: [], totalRooms: 0, totalGuests: 0, totalValue: 0 },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListPassengers: () => ({
    data: [{ id: "passenger-1", name: "Maria", ageCategory: "adult", checkedInAt: null }],
    refetch: vi.fn(),
  }),
  useCreatePassenger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePassenger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePassenger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCheckInPassenger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoCheckInPassenger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetReservationRoomAssignments: mockGetRoomAssignments,
  useUpdateReservationRoomAssignments: () => ({ mutateAsync: mockUpdateAssignments, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("../pages/reservations/PassengerForm.js", () => ({
  PassengerForm: () => null,
}));

vi.mock("../pages/reservations/RoomAllocationSummaryTable.js", () => ({
  RoomAllocationSummaryTable: () => null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: unknown; value: string; onValueChange: (value: string) => void }) =>
    createElement("select", { value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange(event.currentTarget.value) }, children),
  SelectContent: ({ children }: { children: unknown }) => createElement(Fragment, null, children),
  SelectItem: ({ children, value }: { children: unknown; value: string }) => createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { ReservationPassengersTab } from "../pages/reservations/ReservationPassengersTab.js";

beforeEach(() => {
  mockToast.mockReset();
  mockUpdateAssignments.mockReset();
  mockGetRoomAssignments.mockReset();
  mockGetRoomAssignments.mockReturnValue({ data: mockRoomData, isLoading: false, isFetching: false });
  mockUpdateAssignments.mockRejectedValue({
    data: {
      code: "ROOM_CAPACITY_EXCEEDED",
      roomId: "room-full",
      capacity: 2,
      occupied: 3,
      currentOccupied: 2,
      requestedCount: 1,
    },
  });
});

afterEach(async () => {
  await cleanupRoots();
});

describe("ReservationPassengersTab room capacity feedback", () => {
  it("identifies the full room and keeps the pending selection available", async () => {
    const handle = await renderComponent(createElement(ReservationPassengersTab, { reservationId: "reservation-1" }));
    const saveButton = Array.from(handle.container.querySelectorAll("button")).find(button => button.textContent?.includes("Salvar quartos"));
    const select = handle.container.querySelector("select");

    expect(saveButton).not.toBeUndefined();
    expect(select).not.toBeNull();
    expect((select as HTMLSelectElement).value).toBe("room-full");

    await flushAct(() => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const alert = handle.container.querySelector('[data-testid="room-capacity-error"]');
    expect(alert?.textContent).toContain("Quarto Quarto 101 sem vagas");
    expect(alert?.textContent).toContain("Capacidade: 2 pessoa(s). Ocupação atual: 2.");
    expect(alert?.textContent).toContain("Vagas disponíveis antes desta tentativa: 0.");
    expect(alert?.textContent).toContain("Suas alterações foram mantidas");
    expect((select as HTMLSelectElement).value).toBe("room-full");

    await flushAct(() => {
      (select as HTMLSelectElement).value = "room-other";
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect((select as HTMLSelectElement).value).toBe("room-other");
    expect(handle.container.querySelector('[data-testid="room-capacity-error"]')).toBeNull();
  });

  it("refreshes availability without replacing a pending room choice", async () => {
    const handle = await renderComponent(createElement(ReservationPassengersTab, { reservationId: "reservation-1" }));
    const select = handle.container.querySelector("select") as HTMLSelectElement;

    expect(handle.container.querySelector('[data-testid="room-availability-auto-refresh"]')?.textContent)
      .toContain("a cada 15 segundos");
    expect(mockGetRoomAssignments).toHaveBeenCalledWith(
      "reservation-1",
      expect.objectContaining({
        query: expect.objectContaining({
          refetchInterval: 15_000,
          refetchOnWindowFocus: true,
        }),
      }),
    );

    await flushAct(() => {
      select.value = "room-other";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    mockGetRoomAssignments.mockReturnValue({
      data: {
        ...mockRoomData,
        assignments: [{ passengerId: "passenger-1", roomId: "room-full" }],
        rooms: mockRoomData.rooms.map(room => room.id === "room-other" ? { ...room, occupied: 1, available: 2 } : room),
      },
      isLoading: false,
      isFetching: true,
    });
    await handle.rerender(createElement(ReservationPassengersTab, { reservationId: "reservation-1" }));

    expect(select.value).toBe("room-other");
    expect(handle.container.querySelector('[data-testid="room-availability-auto-refresh"]')?.textContent)
      .toContain("(atualizando...)");
  });
});