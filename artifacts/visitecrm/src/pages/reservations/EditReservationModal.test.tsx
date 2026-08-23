import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, flushAct, renderComponent } from "../../__tests__/eventSourceHarness.js";

type PaymentFixture = {
  id: string;
  reservationId: string;
  clientId: string;
  amount: number;
  paymentMethod: string;
  status: string;
  dueDate: string;
  paidAt: string | null;
};

const testState = vi.hoisted(() => ({
  payments: [] as PaymentFixture[],
  pendingPayment: null as PaymentFixture | null,
  listeners: new Set<() => void>(),
}));
const mockCreatePayment = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());

const reservation = {
  id: "reservation-1",
  voucherCode: "VCH-001",
  tripId: "trip-1",
  clientId: "client-1",
  status: "confirmed",
  seats: ["12"],
  totalValue: 500,
  paidValue: 100,
  balance: 400,
  depositAmount: null,
  paymentMethod: "pix",
  installments: 1,
  isGratuidade: false,
  discountTotal: 0,
  commissionAmount: null,
  sellerId: null,
  notes: null,
  client: { name: "Cliente Teste" },
};

function makePayment(id: string, amount: number): PaymentFixture {
  return {
    id,
    reservationId: reservation.id,
    clientId: reservation.clientId,
    amount,
    paymentMethod: "pix",
    status: "paid",
    dueDate: "2026-08-23",
    paidAt: "2026-08-23T12:00:00.000Z",
  };
}

const passthrough = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);
const button = ({ children, ...props }: ComponentProps<"button">) =>
  createElement("button", props, children);
const input = (props: ComponentProps<"input">) => createElement("input", props);

vi.mock("@workspace/api-client-react", () => ({
  useGetReservation: () => ({ data: reservation, isLoading: false }),
  useListBoardingLocations: () => ({ data: [] }),
  useListUsers: () => ({ data: [] }),
  useGetMe: () => ({ data: { role: "agency_admin" } }),
  useUpdateReservation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useCreatePayment: () => ({ isPending: false, mutateAsync: mockCreatePayment }),
  useDeletePayment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useListPayments: () => {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
      const listener = () => forceUpdate(value => value + 1);
      testState.listeners.add(listener);
      return () => testState.listeners.delete(listener);
    }, []);

    return { data: { data: testState.payments } };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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

function setNativeInputValue(inputElement: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(inputElement, value);
  inputElement.dispatchEvent(new Event("change", { bubbles: true }));
}

function getHistoryText(container: HTMLElement): string | null {
  const heading = Array.from(container.querySelectorAll("h3")).find(
    element => element.textContent === "Histórico de Pagamentos",
  );
  return heading?.parentElement?.parentElement?.textContent ?? null;
}

async function renderModal() {
  const { EditReservationModal } = await import("./EditReservationModal.js");
  return renderComponent(
    createElement(EditReservationModal, {
      reservationId: reservation.id,
      open: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
    }),
  );
}

beforeEach(() => {
  testState.payments = [];
  testState.pendingPayment = null;
  testState.listeners.clear();
  vi.clearAllMocks();

  mockCreatePayment.mockImplementation(
    async ({ data }: { data: { amount: number; paymentMethod: string; status: string; dueDate: string; paidAt: string } }) => {
      testState.pendingPayment = {
        ...makePayment("payment-new", data.amount),
        paymentMethod: data.paymentMethod,
        status: data.status,
        dueDate: data.dueDate,
        paidAt: data.paidAt,
      };
    },
  );
  mockInvalidateQueries.mockImplementation(
    async ({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] !== "payments" || !testState.pendingPayment) return;

      testState.payments = [...testState.payments, testState.pendingPayment];
      testState.pendingPayment = null;
      testState.listeners.forEach(listener => listener());
    },
  );
});

afterEach(async () => {
  await cleanupRoots();
});

describe("EditReservationModal — payment history", () => {
  it("hides payment history when there are no payments", async () => {
    const { container } = await renderModal();

    expect(container.textContent).not.toContain("Histórico de Pagamentos");
  });

  it("shows payment history and its count when payments exist", async () => {
    testState.payments = [makePayment("payment-existing", 100)];

    const { container } = await renderModal();

    const historyText = getHistoryText(container);
    expect(historyText).toContain("Histórico de Pagamentos");
    expect(historyText).toContain("1 registro(s)");
    expect(historyText).toContain("R$ 100,00");
  });

  it("refreshes payment history with the new payment after inline submission", async () => {
    testState.payments = [makePayment("payment-existing", 100)];

    const { container } = await renderModal();

    const initialHistoryText = getHistoryText(container);
    expect(initialHistoryText).toContain("1 registro(s)");
    expect(initialHistoryText).not.toContain("R$ 125,00");

    const paymentAmount = container.querySelector(
      'input[type="number"][max="400"]',
    ) as HTMLInputElement | null;
    expect(paymentAmount).not.toBeNull();

    await flushAct(() => {
      setNativeInputValue(paymentAmount!, "125");
    });

    const paymentForm = container.querySelectorAll("form")[1];
    expect(paymentForm).toBeDefined();

    await flushAct(async () => {
      paymentForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const updatedHistoryText = getHistoryText(container);
    expect(mockCreatePayment).toHaveBeenCalledOnce();
    expect(mockCreatePayment).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: reservation.id,
        amount: 125,
        paymentMethod: "pix",
        status: "paid",
      }),
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["payments", reservation.id],
    });
    expect(testState.payments).toHaveLength(2);
    expect(updatedHistoryText).toContain("2 registro(s)");
    expect(updatedHistoryText).toContain("R$ 125,00");
  });
});