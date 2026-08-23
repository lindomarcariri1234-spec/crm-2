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
import { act, createElement } from "react";
import {
  renderComponent,
  cleanupRoots,
  installMockEventSource,
  restoreEventSource,
} from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values — hoisted so vi.mock factories can close over them.
// ---------------------------------------------------------------------------
const mockGetTripBoardingPanel = vi.hoisted(() => vi.fn());
const mockGetTrip = vi.hoisted(() => vi.fn());
const mockRefetch = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockToast = vi.hoisted(() => vi.fn());
const mockCreateObjectURL = vi.hoisted(() => vi.fn(() => "blob:passengers-csv"));
const mockRevokeObjectURL = vi.hoisted(() => vi.fn());

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function parseCsvLine(line: string): string[] {
  return line
    .split(",")
    .map(value => value.slice(1, -1).replace(/""/g, '"'));
}

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

vi.mock("../pages/trips/WhatsAppBroadcastModal.js", () => ({
  WhatsAppBroadcastModal: () => null,
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

import {
  PassengersList,
  lacksValidWhatsAppReminderContact,
} from "../pages/trips/PassengersList.js";

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

function panelData(
  passengers: ReturnType<typeof makeLapPassenger>[],
  freePassengers: Array<{
    id: string;
    name: string;
    cpf: string | null;
    whatsapp: string | null;
    role: string;
    seatNumber: string | null;
  }> = [],
) {
  return {
    data: {
      tripId: "trip-1",
      tripName: "Praia Grande",
      departureDate: null,
      totalPassengers: passengers.length,
      passengers,
      freePassengers,
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
  installMockEventSource();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: mockCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: mockRevokeObjectURL,
  });
  mockGetTrip.mockReturnValue({ data: undefined });
  mockGetTripBoardingPanel.mockReturnValue(panelData([makeLapPassenger()]));
  mockToast.mockReturnValue(undefined);
  mockRefetch.mockResolvedValue({});
});

afterEach(async () => {
  await cleanupRoots();
  restoreEventSource();
  vi.restoreAllMocks();
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

describe("PassengersList — badge de Gratuidade", () => {
  it("exibe o badge 'Gratuidade' na linha de um passageiro pago marcado como gratuito", async () => {
    mockGetTripBoardingPanel.mockReturnValue(
      panelData([{ ...makeAdultPassenger(), isGratuidade: true }]),
    );

    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    const firstRow = container.querySelector("tbody tr");
    expect(firstRow).not.toBeNull();
    expect(firstRow!.textContent).toContain("João Adulto");
    expect(firstRow!.textContent).toContain("Gratuidade");
  });
});

describe("PassengersList — exportação CSV da coluna Gratuidade", () => {
  it("inclui 'Sim' para passageiros gratuitos, deixa regulares vazios e marca freePassengers", async () => {
    const flaggedPassenger = {
      ...makeAdultPassenger(),
      name: "Passageiro Gratuito",
      isGratuidade: true,
    };
    const regularPassenger = {
      ...makeAdultPassenger(),
      id: "pax-adult-002",
      reservationId: "res-003",
      name: "Passageiro Regular",
      isGratuidade: false,
    };
    const freePassenger = {
      id: "free-guide-001",
      name: "Guia Gratuito",
      cpf: null,
      whatsapp: null,
      role: "guide",
      seatNumber: "1A",
    };
    mockGetTripBoardingPanel.mockReturnValue(
      panelData([flaggedPassenger, regularPassenger], [freePassenger]),
    );

    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );
    const csvButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent?.trim() === "CSV",
    );
    expect(csvButton).not.toBeUndefined();

    await act(async () => {
      csvButton!.click();
    });

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
    const csv = (await readBlobAsText(blob)).replace(/^\uFEFF/, "");
    const lines = csv.split("\n");
    const header = parseCsvLine(lines[0]);
    const gratitudeIndex = header.indexOf("Gratuidade");

    expect(gratitudeIndex).toBeGreaterThanOrEqual(0);
    expect(parseCsvLine(lines[1])[gratitudeIndex]).toBe("Sim");
    expect(parseCsvLine(lines[2])[gratitudeIndex]).toBe("");
    expect(parseCsvLine(lines[3])[gratitudeIndex]).toBe("Sim");
  });
});

describe("PassengersList — aviso de lembrete pelo WhatsApp", () => {
  it("sinaliza de forma acessível o passageiro sem contato válido para lembretes", async () => {
    const { container } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    expect(
      container.querySelector('[aria-label="Sem lembrete pelo WhatsApp: contato inválido"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Sem lembrete WhatsApp");
  });

  it("considera o telefone próprio do passageiro antes do contato do titular", () => {
    expect(
      lacksValidWhatsAppReminderContact({
        passengerPhone: "(31) 99999-9999",
        whatsapp: "319999999",
        phone: null,
      }),
    ).toBe(false);
  });

  it("sinaliza um telefone próprio inválido mesmo quando o titular tem WhatsApp válido", () => {
    expect(
      lacksValidWhatsAppReminderContact({
        passengerPhone: "319999999",
        whatsapp: "(31) 99999-9999",
        phone: null,
      }),
    ).toBe(true);
  });
});
