import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, renderComponent } from "../../__tests__/eventSourceHarness.js";

const mockDuplicateReservations = vi.hoisted(() => vi.fn());

const passthrough = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);

vi.mock("@workspace/api-client-react", () => ({
  useListTrips: () => ({ data: { data: [] } }),
  useListClients: () => ({ data: { data: [] } }),
  useListBoardingLocations: () => ({ data: [] }),
  useListUsers: () => ({ data: [] }),
  useGetMe: () => ({ data: undefined }),
  useCreateReservation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateDeal: () => ({ mutateAsync: vi.fn() }),
  useValidateReservationCoupon: () => ({ mutateAsync: vi.fn() }),
  useGetTrip: () => ({ data: undefined }),
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

vi.mock("../reservations/WizardStep1", () =>
  ({
    WizardStep1: () => createElement("div", { "data-testid": "wizard-step-1" }),
  }),
);

vi.mock("../reservations/WizardStep2", () =>
  ({
    WizardStep2: () => createElement("div", { "data-testid": "wizard-step-2" }),
  }),
);

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
});