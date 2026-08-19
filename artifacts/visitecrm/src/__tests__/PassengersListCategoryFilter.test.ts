/**
 * Regression guard: PassengersList category filter correctly excludes / includes
 * lap-child passengers (ageCategory="baby", seatNumber=null).
 *
 * Two complementary test suites:
 *
 * 1. Pure predicate tests — import the real `filterPassengers` function exported
 *    from PassengersList.tsx and call it directly.  No component rendering.
 *    If the production filter changes, these tests will catch it.
 *
 * 2. Component integration tests — render the full PassengersList, trigger the
 *    category Select's onValueChange via selectRegistry (a vi.hoisted helper),
 *    and assert on the resulting DOM rows.
 *    Select rendering order with boardingPoints=[]:
 *      index 0 → export-status filter
 *      index 1 → category filter  ← target
 *      index 2 → boarding-status filter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Select handler registry — hoisted so vi.mock factory can close over it.
// ---------------------------------------------------------------------------
const selectRegistry = vi.hoisted(() => ({
  handlers: [] as Array<((v: string) => void) | undefined>,
  clear() { this.handlers = []; },
  get(idx: number) { return this.handlers[idx]; },
}));

// ---------------------------------------------------------------------------
// Input onChange handler registry — hoisted so vi.mock factory can close over it.
// ---------------------------------------------------------------------------
const inputRegistry = vi.hoisted(() => ({
  handlers: [] as Array<((e: { target: { value: string } }) => void) | undefined>,
  clear() { this.handlers = []; },
  get(idx: number) { return this.handlers[idx]; },
}));

// ---------------------------------------------------------------------------
// Other controllable hook return values
// ---------------------------------------------------------------------------
const mockGetTripBoardingPanel = vi.hoisted(() => vi.fn());
const mockGetTrip = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockToast = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useGetTrip: mockGetTrip,
  useGetTripBoardingPanel: mockGetTripBoardingPanel,
  useCheckInPassenger: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUndoCheckInPassenger: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useSyncTripPassengers: () => ({ mutateAsync: vi.fn().mockResolvedValue({ created: 0 }) }),
  useUpdatePassengerBoarding: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useBroadcastTripWhatsApp: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    sendManifest: vi.fn().mockResolvedValue({ whatsappUrl: null }),
  },
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: () => ({ occupiedSeats: {}, eventCount: 0, connected: false }),
}));

vi.mock("../pages/trips/PassengerObsModal.js", () => ({
  PassengerObsModal: () => null,
}));

vi.mock("../pages/trips/PassengersListManifest.js", () => ({
  printPassengersManifest: vi.fn(),
}));

vi.mock("../pages/trips/PassengersListShareDialog.js", () => ({
  PassengersListShareDialog: () => null,
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
}));

// Smart Select mock: pushes each instance's onValueChange into selectRegistry
// so tests can imperatively trigger filter changes without DOM events.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: unknown;
    onValueChange?: (v: string) => void;
  }) => {
    selectRegistry.handlers.push(onValueChange);
    return createElement("div", null, children as never);
  },
  SelectTrigger: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    createElement("span", null, placeholder ?? ""),
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children, value }: { children: unknown; value: string }) =>
    createElement("option", { value }, children as never),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsList: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsTrigger: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
  TabsContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: unknown;
    onClick?: () => void;
    disabled?: boolean;
  }) =>
    createElement("button", { onClick, disabled: disabled ?? false }, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("div", { "data-testid": "skeleton" }),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => {
    inputRegistry.handlers.push(props.onChange as ((e: { target: { value: string } }) => void) | undefined);
    return createElement("input", { ...props });
  },
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

import {
  PassengersList,
  filterPassengers,
} from "../pages/trips/PassengersList.js";
import type { GetTripBoardingPanelPassenger } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Passenger = GetTripBoardingPanelPassenger;

function makeBaby(overrides: Partial<Passenger> = {}): Passenger {
  return {
    id: "pax-baby-001",
    reservationId: "res-001",
    voucherCode: "VCHR-0001",
    clientName: "Bebê Silva",
    name: "Bebê Silva",
    ageCategory: "baby",
    seatNumber: null,
    cpf: null,
    birthDate: null,
    whatsapp: null,
    boardingLocationId: null,
    checkedInAt: null,
    observations: null,
    specialNeeds: null,
    documentType: null,
    isGratuidade: false,
    passengerPhone: null,
    ...overrides,
  };
}

function makeAdult(overrides: Partial<Passenger> = {}): Passenger {
  return {
    id: "pax-adult-001",
    reservationId: "res-002",
    voucherCode: "VCHR-0002",
    clientName: "João Adulto",
    name: "João Adulto",
    ageCategory: "adult",
    seatNumber: "12A",
    cpf: null,
    birthDate: null,
    whatsapp: null,
    boardingLocationId: null,
    checkedInAt: null,
    observations: null,
    specialNeeds: null,
    documentType: null,
    isGratuidade: false,
    passengerPhone: null,
    ...overrides,
  };
}

function panelData(passengers: Passenger[]) {
  return {
    data: {
      tripId: "trip-1",
      tripName: "Praia Grande",
      departureDate: null,
      totalPassengers: passengers.length,
      passengers,
      freePassengers: [],
      boardingPoints: [],
    },
    isLoading: false,
    refetch: mockRefetch,
  };
}

// ---------------------------------------------------------------------------
// Pure predicate tests — import the real filterPassengers from production code.
// If the production filter logic changes, these tests will catch regressions.
// ---------------------------------------------------------------------------

describe("PassengersList — filtro de categoria: lógica pura (filterPassengers)", () => {
  it("exclui bebê de colo ao filtrar por 'adult'", () => {
    const result = filterPassengers([makeBaby(), makeAdult()], {
      search: "",
      categoryFilter: "adult",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].ageCategory).toBe("adult");
  });

  it("mantém apenas bebê de colo ao filtrar por 'baby'", () => {
    const result = filterPassengers([makeAdult(), makeBaby()], {
      search: "",
      categoryFilter: "baby",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].ageCategory).toBe("baby");
  });

  it("mostra todos os passageiros quando filtro é 'all'", () => {
    const result = filterPassengers([makeAdult(), makeBaby()], {
      search: "",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(2);
  });

  it("exclui adultos e mantém bebê ao filtrar por 'baby' com múltiplos adultos", () => {
    const passengers = [
      makeAdult({ id: "a1" }),
      makeAdult({ id: "a2" }),
      makeBaby({ id: "b1" }),
    ];
    const result = filterPassengers(passengers, {
      search: "",
      categoryFilter: "baby",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1");
  });

  it("retorna lista vazia quando filtro 'adult' e só há bebês", () => {
    const result = filterPassengers([makeBaby(), makeBaby({ id: "b2" })], {
      search: "",
      categoryFilter: "adult",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pure predicate tests — text search filter (nome/CPF).
// ---------------------------------------------------------------------------

describe("PassengersList — filtro de busca textual: lógica pura (filterPassengers)", () => {
  const adult = makeAdult({ name: "João Adulto", cpf: "12345678900" });
  const baby  = makeBaby({ name: "Bebê Silva",  cpf: null });

  it("busca vazia mostra todos os passageiros (adulto + bebê de colo)", () => {
    const result = filterPassengers([adult, baby], {
      search: "",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(2);
  });

  it("busca pelo nome do adulto exclui o bebê de colo", () => {
    const result = filterPassengers([adult, baby], {
      search: "joão adulto",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].ageCategory).toBe("adult");
  });

  it("busca pelo nome do adulto é case-insensitive", () => {
    const result = filterPassengers([adult, baby], {
      search: "JOÃO ADULTO",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("João Adulto");
  });

  it("busca pelo nome do bebê exclui o adulto", () => {
    const result = filterPassengers([adult, baby], {
      search: "bebê",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].ageCategory).toBe("baby");
  });

  it("busca por CPF do adulto retorna apenas o adulto (bebê sem CPF excluído)", () => {
    const result = filterPassengers([adult, baby], {
      search: "12345678900",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].cpf).toBe("12345678900");
  });

  it("busca por termo inexistente retorna lista vazia", () => {
    const result = filterPassengers([adult, baby], {
      search: "não existe",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(0);
  });

  it("busca parcial por nome corresponde corretamente", () => {
    const result = filterPassengers([adult, baby], {
      search: "joão",
      categoryFilter: "all",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("João Adulto");
  });

  it("busca por nome do adulto combinada com filtro de categoria 'adult' retorna apenas adulto", () => {
    const result = filterPassengers([adult, baby], {
      search: "joão",
      categoryFilter: "adult",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(1);
    expect(result[0].ageCategory).toBe("adult");
  });

  it("busca por nome do adulto combinada com filtro de categoria 'baby' retorna vazio", () => {
    const result = filterPassengers([adult, baby], {
      search: "joão",
      categoryFilter: "baby",
      boardingStatusFilter: "all",
    });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Component integration tests — renders PassengersList and interacts with the
// category filter Select via selectRegistry.
// ---------------------------------------------------------------------------

describe("PassengersList — filtro de categoria: integração no componente", () => {
  beforeEach(() => {
    selectRegistry.clear();
    mockGetTrip.mockReturnValue({ data: undefined });
    mockGetTripBoardingPanel.mockReturnValue(panelData([makeBaby(), makeAdult()]));
    mockToast.mockReturnValue(undefined);
    mockRefetch.mockResolvedValue({});
  });

  afterEach(async () => {
    await cleanupRoots();
    vi.clearAllMocks();
    selectRegistry.clear();
    inputRegistry.clear();
  });

  it("renderiza ambos os passageiros quando filtro é 'all' (padrão)", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toContain("Nenhum passageiro encontrado");
  });

  it("exclui bebê de colo ao filtrar por 'adult' — apenas adulto fica visível", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    // 3 Selects rendered on initial mount: [0]=exportStatus, [1]=category, [2]=boardingStatus
    const triggerCategory = selectRegistry.get(1);
    expect(triggerCategory).toBeDefined();

    await flushAct(() => { triggerCategory!("adult"); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("João Adulto");
    expect(container.textContent).not.toContain("Bebê Silva");
  });

  it("mantém apenas bebê de colo ao filtrar por 'baby'", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const triggerCategory = selectRegistry.get(1);
    expect(triggerCategory).toBeDefined();

    await flushAct(() => { triggerCategory!("baby"); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("Bebê Silva");
    expect(container.textContent).not.toContain("João Adulto");
  });

  it("exibe 'Nenhum passageiro encontrado' quando filtro 'adult' e só há bebês", async () => {
    mockGetTripBoardingPanel.mockReturnValue(panelData([makeBaby()]));
    selectRegistry.clear();

    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const triggerCategory = selectRegistry.get(1);
    expect(triggerCategory).toBeDefined();

    await flushAct(() => { triggerCategory!("adult"); });

    expect(container.textContent).toContain("Nenhum passageiro encontrado");
  });
});

// ---------------------------------------------------------------------------
// Component integration tests — renders PassengersList and interacts with the
// search Input via inputRegistry (captures the onChange handler).
//
// Input rendering order: there is exactly one Input (the search field).
//   index 0 → search Input
// ---------------------------------------------------------------------------

describe("PassengersList — busca textual: integração no componente", () => {
  beforeEach(() => {
    selectRegistry.clear();
    inputRegistry.clear();
    mockGetTrip.mockReturnValue({ data: undefined });
    mockGetTripBoardingPanel.mockReturnValue(panelData([makeBaby(), makeAdult()]));
    mockToast.mockReturnValue(undefined);
    mockRefetch.mockResolvedValue({});
  });

  afterEach(async () => {
    await cleanupRoots();
    vi.clearAllMocks();
    selectRegistry.clear();
    inputRegistry.clear();
  });

  it("digitar o nome do adulto esconde o bebê de colo da tabela", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    // Verify both passengers are shown initially
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);

    // The search Input is the only Input rendered (index 0)
    const triggerSearch = inputRegistry.get(0);
    expect(triggerSearch).toBeDefined();

    await flushAct(() => { triggerSearch!({ target: { value: "João Adulto" } }); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("João Adulto");
    expect(container.textContent).not.toContain("Bebê Silva");
  });

  it("digitar o CPF do adulto mostra apenas o adulto (bebê sem CPF é excluído)", async () => {
    // Adult must have a CPF for this test; baby has cpf=null by default
    mockGetTripBoardingPanel.mockReturnValue(
      panelData([makeBaby(), makeAdult({ cpf: "12345678900" })]),
    );
    selectRegistry.clear();
    inputRegistry.clear();

    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const triggerSearch = inputRegistry.get(0);
    expect(triggerSearch).toBeDefined();

    await flushAct(() => { triggerSearch!({ target: { value: "12345678900" } }); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("João Adulto");
    expect(container.textContent).not.toContain("Bebê Silva");
  });

  it("limpar o campo de busca (string vazia) faz todos os passageiros reaparecerem", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const triggerSearch = inputRegistry.get(0);
    expect(triggerSearch).toBeDefined();

    // First filter down to just the adult
    await flushAct(() => { triggerSearch!({ target: { value: "João Adulto" } }); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);

    // Then clear the search field — all passengers must return
    await flushAct(() => { triggerSearch!({ target: { value: "" } }); });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain("João Adulto");
    expect(container.textContent).toContain("Bebê Silva");
  });
});
