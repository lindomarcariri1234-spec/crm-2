import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const reservation = {
  id: "reservation-1",
  voucherCode: "VCH-001",
  tripId: "trip-1",
  boardingLocationId: "trip-point-1",
  boardingLocation: { name: "Asa de Crato", time: "21:00" },
  clientId: "client-1",
  status: "confirmed",
  seats: ["12"],
  totalValue: 500,
  paidValue: 90,
  balance: 410,
  depositAmount: 90,
  paymentMethod: "pix",
  installments: 1,
  isGratuidade: false,
  discountTotal: 0,
  commissionAmount: null,
  sellerId: null,
  notes: null,
  client: { name: "Cliente Teste" },
};

const passthrough = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
const button = ({ children, ...props }: ComponentProps<"button">) => createElement("button", props, children);
const input = (props: ComponentProps<"input">) => createElement("input", props);
const select = ({ children, value }: { children?: ReactNode; value?: string }) =>
  createElement("div", { "data-select-value": value }, children);
const selectItem = ({ children, value }: { children?: ReactNode; value?: string }) =>
  createElement("div", { "data-select-item-value": value }, children);

vi.mock("@workspace/api-client-react", () => ({
  useGetReservation: () => ({ data: reservation, isLoading: false }),
  useGetTrip: (tripId: string) => ({
    data: tripId === "trip-1"
      ? { boardingPoints: [{ id: "trip-point-1", name: "Asa de Crato", time: "21:00" }] }
      : undefined,
  }),
  useListBoardingLocations: () => ({
    data: [{ id: "catalog-point-1", name: "Terminal Rodoviário", time: "07:00" }],
  }),
  useListUsers: () => ({ data: [] }),
  useGetMe: () => ({ data: { role: "agency_admin" } }),
  useListPayments: () => ({ data: { data: [] } }),
  useUpdateReservation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreatePayment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeletePayment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/ui/button", () => ({ Button: button }));
vi.mock("@/components/ui/input", () => ({ Input: input }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: passthrough,
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: passthrough,
  AlertDialogAction: button,
  AlertDialogCancel: button,
  AlertDialogContent: passthrough,
  AlertDialogDescription: passthrough,
  AlertDialogFooter: passthrough,
  AlertDialogHeader: passthrough,
  AlertDialogTitle: passthrough,
}));
vi.mock("@/components/ui/select", () => ({
  Select: select,
  SelectContent: passthrough,
  SelectItem: selectItem,
  SelectTrigger: passthrough,
  SelectValue: passthrough,
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: passthrough }));
vi.mock("@/components/ui/badge", () => ({ Badge: passthrough }));
vi.mock("lucide-react", () => ({
  DollarSign: passthrough,
  Receipt: passthrough,
  ArrowDown: passthrough,
  Trash2: passthrough,
}));

afterEach(async () => {
  await cleanupRoots();
  reservation.tripId = "trip-1";
  reservation.boardingLocationId = "trip-point-1";
  reservation.boardingLocation = { name: "Asa de Crato", time: "21:00" };
});

describe("EditReservationModal — minimum deposit", () => {
  it("flags a deposit-only reservation and prefills the outstanding balance", async () => {
    const { EditReservationModal } = await import("../pages/reservations/EditReservationModal.js");
    const { container } = await renderComponent(createElement(EditReservationModal, {
      reservationId: reservation.id,
      open: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
    }));

    expect(container.textContent).toContain("Entrada paga · saldo pendente");
    expect(container.textContent).toContain("Entrada: R$ 90,00 · Restante: R$ 410,00");

    const paymentAmount = container.querySelector('input[max="410"]') as HTMLInputElement | null;
    expect(paymentAmount?.value).toBe("410.00");
  });

  it("shows the saved trip-specific boarding point and its time alongside agency locations", async () => {
    const { EditReservationModal } = await import("../pages/reservations/EditReservationModal.js");
    const { container } = await renderComponent(createElement(EditReservationModal, {
      reservationId: reservation.id,
      open: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
    }));

    expect(container.textContent).toContain("Ponto de embarque");
    expect(container.querySelector('[data-select-value="trip-point-1"]')).not.toBeNull();
    expect(container.querySelector('[data-select-item-value="trip-point-1"]')?.textContent)
      .toBe("Asa de Crato");
    expect(container.textContent).toContain("Horário: 21:00");
    expect(container.querySelector('[data-select-item-value="catalog-point-1"]')?.textContent)
      .toBe("Terminal Rodoviário");
  });

  it("keeps a saved boarding point visible if it was removed from the trip and agency lists", async () => {
    reservation.tripId = "trip-with-removed-point";
    reservation.boardingLocationId = "removed-point-1";
    reservation.boardingLocation = { name: "Praça Padre Cícero", time: "06:30" };

    const { EditReservationModal } = await import("../pages/reservations/EditReservationModal.js");
    const { container } = await renderComponent(createElement(EditReservationModal, {
      reservationId: reservation.id,
      open: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
    }));

    expect(container.querySelector('[data-select-value="removed-point-1"]')).not.toBeNull();
    expect(container.querySelector('[data-select-item-value="removed-point-1"]')?.textContent)
      .toBe("Praça Padre Cícero");
    expect(container.textContent).toContain("Horário: 06:30");
  });
});