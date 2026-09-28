import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, flushAct, renderComponent } from "../../__tests__/eventSourceHarness.js";

const mockDuplicateReservations = vi.hoisted(() => vi.fn());
const mockCreateReservation = vi.hoisted(() => vi.fn());
const mockGetTrip = vi.hoisted(() => vi.fn());
const mockBoardingData = vi.hoisted(() => ({
  trip: {
    id: "trip-1",
    name: "Rota do Cariri",
    priceAdult: 500,
    departureDate: "2026-10-15",
    boardingPoints: [
      {
        id: "trip-point-1",
        name: "Asa de Crato",
        time: "21:00",
        address: "Praça Siqueira Campos",
      },
    ],
  },
  catalog: [
    {
      id: "catalog-point-1",
      name: "Terminal Rodoviário",
      address: "Rua do Comércio",
    },
  ],
}));

function resetMockTripBoardingPoints() {
  mockBoardingData.trip.boardingPoints = [
    {
      id: "trip-point-1",
      name: "Asa de Crato",
      time: "21:00",
      address: "Praça Siqueira Campos",
    },
  ];
}

const passthrough = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);

vi.mock("@workspace/api-client-react", () => ({
  useListTrips: () => ({ data: { data: [{ id: "trip-1", name: "Rota do Cariri" }] } }),
  useListClients: () => ({ data: { data: [{ id: "client-1", name: "Cliente Teste" }] } }),
  useListBoardingLocations: () => ({ data: mockBoardingData.catalog }),
  useListUsers: () => ({ data: [] }),
  useGetMe: () => ({ data: undefined }),
  useCreateReservation: () => ({ isPending: false, mutateAsync: mockCreateReservation }),
  useUpdateDeal: () => ({ mutateAsync: vi.fn() }),
  useValidateReservationCoupon: () => ({ mutateAsync: vi.fn() }),
  useGetTrip: (tripId: string, options: { query?: Record<string, unknown> }) => {
    mockGetTrip(tripId, options);
    return { data: mockBoardingData.trip };
  },
  useGetClientLoyalty: () => ({ data: undefined }),
  useCreateClient: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useListReservations: () => ({
    data: { data: mockDuplicateReservations() },
  }),
  validateReferralCode: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    data: { data: [] },
    isFetching: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("../reservations/WizardStep1", () => ({
  WizardStep1: ({
    boardingOptions,
    boardingLocationId,
    onSelectBoarding,
    onSelectSeats,
    onNext,
  }: {
    boardingOptions: { id: string; name: string; time?: string | null; address?: string | null }[];
    boardingLocationId: string;
    onSelectBoarding: (id: string) => void;
    onSelectSeats: (seats: string[]) => void;
    onNext: () => void;
  }) => createElement(
    "div",
    { "data-testid": "wizard-step-1", "data-selected-boarding": boardingLocationId },
    ...boardingOptions.map((point) => createElement(
      "div",
      { "data-testid": `boarding-point-${point.id}`, key: point.id },
      [
        point.name,
        point.time ? `Horário: ${point.time}` : "",
        point.address ? `Endereço: ${point.address}` : "",
      ].filter(Boolean).join(" · "),
    )),
    createElement("button", {
      type: "button",
      "data-testid": "select-trip-point",
      onClick: () => onSelectBoarding("trip-point-1"),
    }, "Selecionar ponto"),
    createElement("button", {
      type: "button",
      "data-testid": "choose-trip-point",
      onClick: () => {
        onSelectSeats(["12"]);
        onSelectBoarding("trip-point-1");
        onNext();
      },
    }, "Continuar"),
  ),
}));

vi.mock("../reservations/WizardStep2", () => ({
  WizardStep2: ({ onNext }: { onNext: () => void }) => createElement(
    "button",
    { type: "button", "data-testid": "finish-step-2", onClick: onNext },
    "Continuar para confirmação",
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: passthrough,
  DialogContent: passthrough,
  DialogHeader: passthrough,
  DialogTitle: passthrough,
  DialogFooter: passthrough,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => createElement("input", props),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: ComponentProps<"label">) =>
    createElement("label", props, children),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => createElement("hr"),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    id,
    onCheckedChange,
  }: {
    checked?: boolean;
    id?: string;
    onCheckedChange?: (checked: boolean) => void;
  }) =>
    createElement("input", {
      type: "checkbox",
      id,
      checked,
      onChange: event => onCheckedChange?.(event.currentTarget.checked),
    }),
}));

vi.mock("lucide-react", () => ({
  AlertTriangle: () => createElement("span"),
  XCircle: () => createElement("span"),
}));

vi.mock("@/lib/labels", () => ({
  PAYMENT_METHOD_LABELS: {},
}));

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
  resetMockTripBoardingPoints();
});

describe("NewReservationWizard duplicate banner status labels", () => {
  it.each([
    ["pending", "Pendente"],
    ["confirmed", "Confirmada"],
  ])("renders %s as %s instead of the raw status", async (status, translatedStatus) => {
    mockDuplicateReservations.mockReturnValue([
      {
        id: "reservation-1",
        reservationNumber: "RES-001",
        status,
      },
    ]);

    const { NewReservationWizard } = await import("./NewReservationWizard.js");
    const { container } = await renderComponent(
      createElement(NewReservationWizard, {
        open: true,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        initialTripId: "trip-1",
        initialClientId: "client-1",
      }),
    );

    const banner = container.querySelector(".border-red-300");
    const bannerText = banner?.textContent ?? "";

    expect(banner).not.toBeNull();
    expect(bannerText).toContain(translatedStatus);
    expect(bannerText).not.toContain(status);
  });

  it("keeps trip and catalog boarding choices, then saves the selected trip-point ID", async () => {
    mockDuplicateReservations.mockReturnValue([]);
    mockCreateReservation.mockResolvedValue({ id: "reservation-created" });

    const { NewReservationWizard } = await import("./NewReservationWizard.js");
    const { container } = await renderComponent(
      createElement(NewReservationWizard, {
        open: true,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
        initialTripId: "trip-1",
        initialClientId: "client-1",
      }),
    );

    expect(container.querySelector('[data-testid="boarding-point-trip-point-1"]')?.textContent)
      .toContain("Asa de Crato · Horário: 21:00 · Endereço: Praça Siqueira Campos");
    expect(container.querySelector('[data-testid="boarding-point-catalog-point-1"]')?.textContent)
      .toContain("Terminal Rodoviário");

    const choosePoint = container.querySelector('[data-testid="choose-trip-point"]') as HTMLButtonElement | null;
    expect(choosePoint).not.toBeNull();
    await flushAct(() => choosePoint?.click());

    const finishPayment = container.querySelector('[data-testid="finish-step-2"]') as HTMLButtonElement | null;
    expect(finishPayment).not.toBeNull();
    await flushAct(() => finishPayment?.click());

    expect(container.textContent).toContain("Asa de Crato");
    expect(container.textContent).toContain("Horário: 21:00");
    expect(container.textContent).toContain("Endereço: Praça Siqueira Campos");

    const confirm = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Confirmar Reserva"));
    expect(confirm).toBeDefined();
    await flushAct(() => confirm?.click());

    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    const createCall = mockCreateReservation.mock.calls[0] as unknown as
      [{ data: { boardingLocationId: string | null } }] | undefined;
    expect(createCall?.[0].data.boardingLocationId).toBe("trip-point-1");
  });

  it("shows refreshed boarding details while the wizard stays open", async () => {
    mockDuplicateReservations.mockReturnValue([]);

    const { NewReservationWizard } = await import("./NewReservationWizard.js");
    const wizardProps = {
      open: true,
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      initialTripId: "trip-1",
      initialClientId: "client-1",
    };
    const { container, rerender } = await renderComponent(
      createElement(NewReservationWizard, wizardProps),
    );

    expect(mockGetTrip).toHaveBeenCalledWith(
      "trip-1",
      expect.objectContaining({
        query: expect.objectContaining({
          queryKey: ["wizard-trip", "trip-1"],
          enabled: true,
          refetchInterval: 15_000,
        }),
      }),
    );
    expect(container.querySelector('[data-testid="boarding-point-trip-point-1"]')?.textContent)
      .toContain("Asa de Crato · Horário: 21:00");
    const selectPoint = container.querySelector('[data-testid="select-trip-point"]') as HTMLButtonElement | null;
    expect(selectPoint).not.toBeNull();
    await flushAct(() => selectPoint?.click());
    expect(container.querySelector('[data-testid="wizard-step-1"]')?.getAttribute("data-selected-boarding"))
      .toBe("trip-point-1");

    mockBoardingData.trip.boardingPoints = [{
      id: "trip-point-1",
      name: "Asa de Crato - atualizado",
      time: "22:30",
      address: "Rua Nova, 42",
    }];
    await rerender(createElement(NewReservationWizard, wizardProps));

    expect(container.querySelector('[data-testid="boarding-point-trip-point-1"]')?.textContent)
      .toContain("Asa de Crato - atualizado · Horário: 22:30 · Endereço: Rua Nova, 42");
    expect(container.textContent).not.toContain("Praça Siqueira Campos");

    mockBoardingData.trip.boardingPoints = [];
    await rerender(createElement(NewReservationWizard, wizardProps));

    expect(container.querySelector('[data-testid="wizard-step-1"]')?.getAttribute("data-selected-boarding"))
      .toBe("");
    expect(container.querySelector('[data-testid="boarding-point-trip-point-1"]')).toBeNull();
  });
});