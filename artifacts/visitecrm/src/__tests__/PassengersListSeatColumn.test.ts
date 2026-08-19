/**
 * Regression guard: PassengersList renders "—" in the Poltrona column when a
 * passenger has seatNumber=null (bebê de colo / isOnLap).
 *
 * The component renders:
 *   {visibleCols.seatNumber && <td className="p-3 whitespace-nowrap">{p.seatNumber ?? "—"}</td>}
 *
 * visibleCols defaults to ALL_COLS_ON (seatNumber: true), so the seatNumber
 * cell is always visible unless the user unchecks it.  This test ensures a
 * baby passenger with seatNumber=null produces the fallback "—" cell, and that
 * a regular adult with a seat number shows the number instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values — hoisted so vi.mock factories can close over them.
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
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    sendManifest: vi.fn().mockResolvedValue({ whatsappUrl: null }),
  },
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

// Radix Dialog uses portals + focus management that jsdom doesn't support.
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

// Radix Select also uses portals.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectTrigger: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    createElement("span", null, placeholder ?? ""),
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children, value }: { children: unknown; value: string }) =>
    createElement("option", { value }, children as never),
}));

// Radix Tabs uses context + portals.
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
  }) => createElement("button", { onClick, disabled: disabled ?? false }, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("div", { "data-testid": "skeleton" }),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    createElement("input", { ...props }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));

// lucide-react — keep real icons (they are just SVGs; safe in jsdom).
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

import { PassengersList } from "../pages/trips/PassengersList.js";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/**
 * Find the seat (Poltrona) cell in the first data row by matching the column
 * header index. This avoids confusion with other columns that also render "—"
 * for null values (birthDate, boardingLocation, etc.).
 */
function getSeatCell(container: HTMLElement): HTMLElement | null {
  const headers = Array.from(container.querySelectorAll("thead th"));
  const seatIndex = headers.findIndex(th => th.textContent?.trim() === "Poltrona");
  if (seatIndex === -1) return null;
  const firstRow = container.querySelector("tbody tr");
  if (!firstRow) return null;
  const cells = Array.from(firstRow.querySelectorAll("td"));
  return (cells[seatIndex] as HTMLElement) ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLapPassenger() {
  return {
    id: "pax-lap-001",
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
  };
}

function makeAdultPassenger() {
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
  };
}

function panelData(passengers: ReturnType<typeof makeLapPassenger>[]) {
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
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetTrip.mockReturnValue({ data: undefined });
  mockGetTripBoardingPanel.mockReturnValue(panelData([makeLapPassenger()]));
  mockToast.mockReturnValue(undefined);
  mockRefetch.mockResolvedValue({});
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PassengersList — coluna Poltrona para bebê de colo (seatNumber=null)", () => {
  it("exibe badge 'No colo' na célula Poltrona quando o passageiro tem seatNumber=null e ageCategory='baby'", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    // The Poltrona header must be present
    const headers = Array.from(container.querySelectorAll("th"));
    const poltronaHeader = headers.find(th => th.textContent?.includes("Poltrona"));
    expect(poltronaHeader).toBeTruthy();

    // The seat cell (located by column index) must display the "No colo" badge
    const seatCell = getSeatCell(container);
    expect(seatCell).not.toBeNull();
    expect(seatCell!.textContent?.trim()).toBe("No colo");
  });

  it("não exibe número de poltrona nem '—' quando passageiro é bebê de colo", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    // Use column-index lookup to isolate the exact Poltrona cell.
    const seatCell = getSeatCell(container);
    expect(seatCell).not.toBeNull();
    // Badge replaces "—" — the cell must NOT be just a dash
    expect(seatCell!.textContent?.trim()).not.toBe("—");
    expect(seatCell!.textContent?.trim()).toBe("No colo");
  });

  it("exibe o número da poltrona quando seatNumber está preenchido", async () => {
    mockGetTripBoardingPanel.mockReturnValue(panelData([makeAdultPassenger()]));

    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    // Use column-index lookup so other null-value columns don't interfere.
    const seatCell = getSeatCell(container);
    expect(seatCell).not.toBeNull();
    expect(seatCell!.textContent).toBe("12A");
  });

  it("exibe o cabeçalho 'Poltrona' na tabela quando a coluna está visível", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const headerTexts = Array.from(container.querySelectorAll("th")).map(
      th => th.textContent,
    );
    expect(headerTexts).toContain("Poltrona");
  });

  it("exibe a categoria 'Bebê' para passageiro com ageCategory='baby'", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    expect(container.textContent).toContain("Bebê");
  });

  it("renderiza o nome do passageiro de colo na tabela", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    expect(container.textContent).toContain("Bebê Silva");
  });
});
