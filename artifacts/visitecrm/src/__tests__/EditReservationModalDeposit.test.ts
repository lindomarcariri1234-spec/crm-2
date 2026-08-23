import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const reservation = {
  id: "reservation-1",
  voucherCode: "VCH-001",
  tripId: "trip-1",
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

vi.mock("@workspace/api-client-react", () => ({
  useGetReservation: () => ({ data: reservation, isLoading: false }),
  useListBoardingLocations: () => ({ data: [] }),
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
  Select: passthrough,
  SelectContent: passthrough,
  SelectItem: passthrough,
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
});