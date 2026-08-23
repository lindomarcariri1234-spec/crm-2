import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockGetTrip = vi.hoisted(() => vi.fn());
const mockUpdateTrip = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  useLocation: () => ["/trips/trip-1/edit", mockNavigate],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTrip: mockGetTrip,
  useCreateTrip: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTrip: () => ({ mutateAsync: mockUpdateTrip, isPending: false }),
  useListLayouts: () => ({ data: [] }),
  useListBoardingLocations: () => ({ data: [] }),
  useGetCurrentSubscription: () => ({
    data: { plan: { supportedFeatures: [] } },
  }),
  useGetMe: () => ({ data: { role: "admin" } }),
}));

vi.mock("@workspace/permissions", () => ({
  TRIP_STATUS: { ACTIVE: "active" },
  hasPermission: () => false,
  RESOURCES: { FINANCIAL: "financial" },
  ACTIONS: { VIEW: "view" },
}));

vi.mock("../pages/trips/constants.js", () => ({
  TRIP_TYPES: ["excursao"],
  TRIP_TYPE_LABELS: { excursao: "Excursão" },
  VEHICLE_TYPES: [],
  FIXED_COST_CATEGORIES: [],
  VARIABLE_COST_CATEGORIES: [],
}));

vi.mock("@/components/plan-limit-wall", () => ({
  PlanLimitWall: () => createElement("div"),
  usePlanLimitError: () => ({ isLimitError: false }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    disabled,
    onClick,
    type,
  }: Record<string, unknown>) =>
    createElement(
      "button",
      {
        className: (className as string) || "",
        disabled: Boolean(disabled),
        onClick,
        type: (type as string) || "button",
      },
      children as never,
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    createElement("input", {
      type: (props.type as string) || "text",
      value: (props.value as string) ?? "",
      placeholder: (props.placeholder as string) || "",
      className: (props.className as string) || "",
      onChange: props.onChange as (event: { target: { value: string } }) => void,
      readOnly: !props.onChange,
    }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) =>
    createElement("textarea", {
      value: (props.value as string) ?? "",
      placeholder: (props.placeholder as string) || "",
      onChange: props.onChange as (event: { target: { value: string } }) => void,
      readOnly: !props.onChange,
    }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectTrigger: ({ children, className }: { children: unknown; className?: string }) =>
    createElement("button", { className: className || "" }, children as never),
  SelectValue: () => createElement("span"),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
  }: {
    children: unknown;
    value?: string;
  }) => createElement("div", { "data-active-tab": value }, children as never),
  TabsContent: ({
    children,
    value,
  }: {
    children: unknown;
    value: string;
  }) => createElement("div", { "data-tab-content": value }, children as never),
  TabsList: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsTrigger: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogFooter: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("div"),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: () => createElement("button"),
}));

vi.mock("@/components/cover-image-upload", () => ({
  CoverImageUpload: () => createElement("div"),
}));

vi.mock("@/components/gallery-upload", () => ({
  GalleryUpload: () => createElement("div"),
}));

vi.mock("@/components/video-gallery-upload", () => ({
  VideoGalleryUpload: () => createElement("div"),
}));

vi.mock("../pages/trips/TiptapEditor.js", () => ({
  TiptapEditor: () => createElement("div"),
}));

vi.mock("../pages/trips/TripCostsSection.js", () => ({
  LayoutMiniPreview: () => createElement("div"),
  TripCostsTab: () => createElement("div"),
}));

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    AlertTriangle: Icon,
    ArrowLeft: Icon,
    Camera: Icon,
    Check: Icon,
    Clock: Icon,
    GripVertical: Icon,
    Link2: Icon,
    Loader2: Icon,
    Lock: Icon,
    MapPin: Icon,
    Plus: Icon,
    X: Icon,
  };
});

import { TripForm } from "../pages/trips/TripForm.js";

function makeTrip() {
  return {
    id: "trip-1",
    name: "Viagem de Teste",
    description: null,
    destination: "Praia do Forte",
    destinationCity: "Mata de São João",
    destinationState: "BA",
    originCity: null,
    originState: null,
    type: "excursao",
    category: "standard",
    departureDate: "2026-09-20T00:00:00.000Z",
    returnDate: null,
    departureTime: null,
    returnTime: null,
    totalCapacity: 46,
    seatLayout: "2x2",
    layoutId: null,
    showSeatMap: true,
    priceAdult: 300,
    priceChild: null,
    priceSenior: null,
    inclusions: [],
    exclusions: [],
    coverImage: null,
    vehicleType: null,
    vehiclePlate: null,
    driverName: null,
    tourGuide: null,
    tripOrganizer: null,
    driver1Cpf: null,
    driver1Cnh: null,
    driver1CnhCategory: null,
    driver1CnhExpiry: null,
    driver2Name: null,
    driver2Cpf: null,
    driver2Cnh: null,
    driver2CnhCategory: null,
    driver2CnhExpiry: null,
    tourGuideCpf: null,
    tourGuideRegistration: null,
    status: "draft",
    boardingPoints: [],
    itinerary: [],
    fixedCosts: [],
    variableCosts: [],
    gallery: [],
    videos: [],
    freePassengers: [
      {
        id: "free-passenger-1",
        name: "Maria da Silva",
        cpf: "",
        whatsapp: "",
        role: "organizer",
        seatNumber: "12",
        checkedInAt: null,
      },
    ],
  };
}

beforeEach(() => {
  mockGetTrip.mockReturnValue({ data: makeTrip() });
  mockUpdateTrip.mockRejectedValue({
    response: {
      data: {
        code: "SEAT_CONFLICT",
        conflictingSeats: ["12"],
      },
    },
  });
  mockToast.mockReset();
  mockNavigate.mockReset();
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("TripForm — conflito de assento ao salvar", () => {
  it("seleciona Transporte e exibe todos os avisos após SEAT_CONFLICT", async () => {
    const { container } = await renderComponent(
      createElement(TripForm, { tripId: "trip-1" }),
    );
    await flushAct(() => {});

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Salvar como Rascunho"),
    );
    expect(saveButton).toBeDefined();

    await flushAct(() => {
      saveButton?.click();
    });

    expect(mockUpdateTrip).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-active-tab="transporte"]')).not.toBeNull();

    const seatInput = container.querySelector(
      'input[placeholder="Ex: 12"]',
    ) as HTMLInputElement | null;
    expect(seatInput).not.toBeNull();
    expect(seatInput?.className).toContain("border-destructive");
    expect(container.textContent).toContain(
      "Assento 12 já está ocupado por uma reserva ativa.",
    );
    expect(container.textContent).toContain(
      "Os assentos 12 já estão ocupados por reservas ativas. Escolha outros assentos.",
    );
    const alertBanner = Array.from(container.querySelectorAll("div")).find(
      (element) =>
        element.className.includes("bg-destructive/10") &&
        element.textContent?.includes("Os assentos 12 já estão ocupados"),
    );
    expect(alertBanner).toBeDefined();
  });

  it("bloqueia o salvamento quando passageiros gratuitos compartilham um assento", async () => {
    mockGetTrip.mockReturnValue({
      data: {
        ...makeTrip(),
        freePassengers: [
          {
            id: "free-passenger-1",
            name: "Maria da Silva",
            cpf: "",
            whatsapp: "",
            role: "organizer",
            seatNumber: "12",
            checkedInAt: null,
          },
          {
            id: "free-passenger-2",
            name: "João da Silva",
            cpf: "",
            whatsapp: "",
            role: "guide",
            seatNumber: " 12 ",
            checkedInAt: null,
          },
        ],
      },
    });

    const { container } = await renderComponent(
      createElement(TripForm, { tripId: "trip-1" }),
    );
    await flushAct(() => {});

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Salvar como Rascunho"),
    );
    await flushAct(() => {
      saveButton?.click();
    });

    expect(mockUpdateTrip).not.toHaveBeenCalled();
    expect(container.querySelector('[data-active-tab="transporte"]')).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith({
      title: "O assento 12 está atribuído a mais de um passageiro gratuito. Escolha assentos diferentes.",
      variant: "destructive",
    });
  });
});