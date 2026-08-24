/**
 * downloads.test.ts
 *
 * Unit tests for the pure utility functions in downloads-utils.ts:
 *   - inDateRange
 *   - prepareClients  — date filter on createdAt
 *   - prepareTrips    — date filter on departureDate
 *   - prepareManifest — date filter on trip.departureDate; seat expansion
 *   - prepareReferrals — date filter on createdAt; bonusPaid label
 *   - prepareCommissions — date filter on createdAt; sellerName vs userId
 *   - downloadXlsx   — SheetJS call shape
 *   - downloadPdf    — jsPDF + autoTable call shape
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";

import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

// --------------------------------------------------------------------------
// Downloads page component mocks
// --------------------------------------------------------------------------
const downloadsApiMocks = vi.hoisted(() => ({
  useListReferrals: vi.fn(() => ({ data: { data: [] } })),
  useListCommissions: vi.fn(() => ({ data: [] })),
  useListDeals: vi.fn(() => ({ data: [] })),
}));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => downloadsApiMocks);

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// --------------------------------------------------------------------------
// XLSX mock — factory uses vi.fn() directly (safe to hoist)
// --------------------------------------------------------------------------
vi.mock("xlsx", () => ({
  utils: {
    aoa_to_sheet: vi.fn().mockReturnValue({ s: {}, e: {} }),
    book_new: vi.fn().mockReturnValue({}),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

// --------------------------------------------------------------------------
// jsPDF + autoTable mocks
// --------------------------------------------------------------------------
vi.mock("jspdf", () => ({
  jsPDF: vi.fn().mockImplementation(() => ({
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    text: vi.fn(),
    save: vi.fn(),
  })),
}));

vi.mock("jspdf-autotable", () => ({
  default: vi.fn(),
}));

// --------------------------------------------------------------------------
// date-fns — real implementation (no mock needed)
// --------------------------------------------------------------------------

// Import the module under test AFTER all vi.mock() declarations
import {
  inDateRange,
  fmtDate,
  fmtCur,
  prepareClients,
  prepareTrips,
  prepareManifest,
  prepareReferrals,
  prepareCommissions,
  downloadXlsx,
  downloadPdf,
} from "../pages/downloads-utils.js";

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import Downloads from "../pages/downloads.js";

// --------------------------------------------------------------------------
// Shared helpers — minimal fixture factories
// --------------------------------------------------------------------------

function makeClient(overrides?: Record<string, unknown>) {
  return {
    id: "c1",
    name: "Ana Costa",
    email: "ana@test.com",
    whatsapp: "11999990001",
    phone: null,
    cpf: null,
    birthDate: null,
    gender: null,
    addressCity: null,
    addressState: null,
    instagram: null,
    classification: "A",
    status: "ativo",
    pipelineStage: "lead",
    totalSpent: 1500,
    outstandingBalance: 200,
    observations: null,
    tags: ["vip"],
    dreamDestinations: ["Paris"],
    createdAt: "2025-03-15T10:00:00Z",
    updatedAt: "2025-03-15T10:00:00Z",
    ...overrides,
  };
}

function makeTrip(overrides?: Record<string, unknown>) {
  return {
    id: "t1",
    name: "Viagem Bahia",
    destination: "Bahia",
    destinationCity: "Salvador",
    destinationState: "BA",
    type: "rodoviário",
    category: "lazer",
    departureDate: "2025-06-10",
    returnDate: "2025-06-17",
    totalCapacity: 50,
    availableSeats: 20,
    reservedSeats: 30,
    priceAdult: 800,
    priceChild: 400,
    priceSenior: 720,
    status: "ativo",
    isPublic: true,
    createdAt: "2025-01-10T00:00:00Z",
    ...overrides,
  };
}

function makeReservation(overrides?: Record<string, unknown>) {
  return {
    id: "r1",
    createdAt: "2025-05-01T00:00:00Z",
    status: "confirmado",
    seats: ["12A", "12B"],
    totalValue: 1600,
    paidValue: 800,
    balance: 800,
    paymentMethod: "pix",
    installments: 1,
    client: { name: "Ana Costa", whatsapp: "11999990001" },
    trip: { name: "Viagem Bahia", departureDate: "2025-06-10" },
    ...overrides,
  };
}

function makeReferral(overrides?: Record<string, unknown>) {
  return {
    id: "ref1",
    tenantId: "t1",
    referrerId: "u1",
    referrerName: "Carlos Souza",
    referredId: "u2",
    referredEmail: "maria@test.com",
    referredName: "Maria Lima",
    code: "CARLOS10",
    status: "converted",
    bonusAmount: "50.00",
    bonusPaid: true,
    convertedAt: "2025-04-20T00:00:00Z",
    createdAt: "2025-03-05T00:00:00Z",
    discountType: "percentage",
    discountValue: "10",
    discountApplied: true,
    ...overrides,
  };
}

function makeCommission(overrides?: Record<string, unknown>) {
  return {
    id: "com1",
    tenantId: "t1",
    userId: "u-seller-1",
    sellerName: "Pedro Vendas",
    reservationId: "r1",
    baseAmount: "1000.00",
    commissionAmount: "100.00",
    status: "pending",
    paidAt: null,
    createdAt: "2025-04-10T00:00:00Z",
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// inDateRange
// --------------------------------------------------------------------------

describe("inDateRange", () => {
  it("returns true when date is inside range (same day)", () => {
    expect(inDateRange("2025-06-01T00:00:00Z", "2025-06-01", "2025-06-30")).toBe(true);
  });

  it("returns true on the last day of range", () => {
    expect(inDateRange("2025-06-30T23:59:59Z", "2025-06-01", "2025-06-30")).toBe(true);
  });

  it("returns false when date is before range", () => {
    expect(inDateRange("2025-05-31T00:00:00Z", "2025-06-01", "2025-06-30")).toBe(false);
  });

  it("returns false when date is after range", () => {
    expect(inDateRange("2025-07-01T00:00:00Z", "2025-06-01", "2025-06-30")).toBe(false);
  });

  it("returns false for null", () => {
    expect(inDateRange(null, "2025-06-01", "2025-06-30")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(inDateRange(undefined, "2025-06-01", "2025-06-30")).toBe(false);
  });
});

// --------------------------------------------------------------------------
// prepareClients
// --------------------------------------------------------------------------

describe("prepareClients", () => {
  const RANGE_START = "2025-03-01";
  const RANGE_END = "2025-03-31";

  it("returns only clients whose createdAt falls in the range", () => {
    const inRange = makeClient({ createdAt: "2025-03-15T10:00:00Z" });
    const before = makeClient({ id: "c2", createdAt: "2025-02-28T00:00:00Z" });
    const after = makeClient({ id: "c3", createdAt: "2025-04-01T00:00:00Z" });

    const { rows, count } = prepareClients(
      [inRange, before, after] as any[],
      RANGE_START,
      RANGE_END,
    );

    expect(count).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Ana Costa");
  });

  it("returns empty rows when no client falls in range", () => {
    const c = makeClient({ createdAt: "2024-01-01T00:00:00Z" });
    const { rows, count } = prepareClients([c] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("includes all clients when all are in range", () => {
    const c1 = makeClient({ id: "c1", createdAt: "2025-03-01T00:00:00Z" });
    const c2 = makeClient({ id: "c2", createdAt: "2025-03-31T00:00:00Z" });
    const { count } = prepareClients([c1, c2] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(2);
  });

  it("maps tags array to semicolon-separated string", () => {
    const c = makeClient({
      tags: ["vip", "fidelizado"],
      createdAt: "2025-03-10T00:00:00Z",
    });
    const { rows } = prepareClients([c] as any[], RANGE_START, RANGE_END);
    const tagsCol = rows[0][15];
    expect(tagsCol).toBe("vip; fidelizado");
  });

  it("maps dreamDestinations array to semicolon-separated string", () => {
    const c = makeClient({
      dreamDestinations: ["Paris", "Roma"],
      createdAt: "2025-03-10T00:00:00Z",
    });
    const { rows } = prepareClients([c] as any[], RANGE_START, RANGE_END);
    const destCol = rows[0][16];
    expect(destCol).toBe("Paris; Roma");
  });

  it("includes the expected number of headers", () => {
    const { headers } = prepareClients([], "2025-01-01", "2025-12-31");
    expect(headers).toContain("Nome");
    expect(headers).toContain("E-mail");
    expect(headers).toContain("Cadastrado em");
    expect(headers.length).toBeGreaterThan(10);
  });
});

// --------------------------------------------------------------------------
// prepareTrips
// --------------------------------------------------------------------------

describe("prepareTrips", () => {
  const RANGE_START = "2025-06-01";
  const RANGE_END = "2025-06-30";

  it("filters trips by departureDate, not createdAt", () => {
    const inRange = makeTrip({ departureDate: "2025-06-10", createdAt: "2025-01-01T00:00:00Z" });
    const outRange = makeTrip({ id: "t2", departureDate: "2025-07-15", createdAt: "2025-06-05T00:00:00Z" });

    const { rows, count } = prepareTrips([inRange, outRange] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(1);
    expect(rows[0][0]).toBe("Viagem Bahia");
  });

  it("returns empty when no trip departs in range", () => {
    const t = makeTrip({ departureDate: "2025-05-01" });
    const { rows, count } = prepareTrips([t] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("maps isPublic=true to 'Sim'", () => {
    const t = makeTrip({ departureDate: "2025-06-10", isPublic: true });
    const { rows } = prepareTrips([t] as any[], RANGE_START, RANGE_END);
    expect(rows[0][15]).toBe("Sim");
  });

  it("maps isPublic=false to 'Não'", () => {
    const t = makeTrip({ departureDate: "2025-06-10", isPublic: false });
    const { rows } = prepareTrips([t] as any[], RANGE_START, RANGE_END);
    expect(rows[0][15]).toBe("Não");
  });

  it("converts numeric seat counts to strings", () => {
    const t = makeTrip({ departureDate: "2025-06-10", totalCapacity: 50, availableSeats: 20, reservedSeats: 30 });
    const { rows } = prepareTrips([t] as any[], RANGE_START, RANGE_END);
    expect(rows[0][8]).toBe("50");
    expect(rows[0][9]).toBe("20");
    expect(rows[0][10]).toBe("30");
  });
});

// --------------------------------------------------------------------------
// prepareManifest
// --------------------------------------------------------------------------

describe("prepareManifest", () => {
  const RANGE_START = "2025-06-01";
  const RANGE_END = "2025-06-30";

  it("expands one row per seat for reservations in range", () => {
    const r = makeReservation({ seats: ["10A", "10B", "10C"], trip: { name: "Trip X", departureDate: "2025-06-10" } });
    const { rows, count } = prepareManifest([r] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows[0][4]).toBe("10A");
    expect(rows[1][4]).toBe("10B");
    expect(rows[2][4]).toBe("10C");
  });

  it("filters by trip.departureDate, not reservation.createdAt", () => {
    const inRange = makeReservation({
      id: "r1",
      createdAt: "2024-01-01T00:00:00Z",
      trip: { name: "Trip A", departureDate: "2025-06-15" },
      seats: ["5A"],
    });
    const outRange = makeReservation({
      id: "r2",
      createdAt: "2025-06-05T00:00:00Z",
      trip: { name: "Trip B", departureDate: "2025-07-20" },
      seats: ["6A"],
    });

    const { rows, count } = prepareManifest([inRange, outRange] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(1);
    expect(rows[0][0]).toBe("Trip A");
  });

  it("returns zero rows when no reservation departs in range", () => {
    const r = makeReservation({ trip: { name: "Trip Z", departureDate: "2024-12-25" }, seats: ["1A"] });
    const { count } = prepareManifest([r] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
  });

  it("uses the client's name and whatsapp on each seat row", () => {
    const r = makeReservation({
      seats: ["7A"],
      client: { name: "João", whatsapp: "11999990002" },
      trip: { name: "Trip Y", departureDate: "2025-06-05" },
    });
    const { rows } = prepareManifest([r] as any[], RANGE_START, RANGE_END);
    expect(rows[0][2]).toBe("João");
    expect(rows[0][3]).toBe("11999990002");
  });

  it("handles reservations with no seats gracefully", () => {
    const r = makeReservation({ seats: [], trip: { name: "Trip W", departureDate: "2025-06-10" } });
    const { count } = prepareManifest([r] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
  });

  it("includes the expected headers", () => {
    const { headers } = prepareManifest([], "2025-01-01", "2025-12-31");
    expect(headers).toContain("Viagem");
    expect(headers).toContain("Assento");
    expect(headers).toContain("Passageiro");
    expect(headers).toContain("Reserva");
  });
});

// --------------------------------------------------------------------------
// prepareReferrals
// --------------------------------------------------------------------------

describe("prepareReferrals", () => {
  const RANGE_START = "2025-03-01";
  const RANGE_END = "2025-03-31";

  it("filters referrals by createdAt", () => {
    const inRange = makeReferral({ id: "ref1", createdAt: "2025-03-05T00:00:00Z" });
    const outRange = makeReferral({ id: "ref2", createdAt: "2025-04-01T00:00:00Z" });

    const { rows, count } = prepareReferrals([inRange, outRange] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(1);
    expect(rows[0][0]).toBe("ref1");
  });

  it("maps bonusPaid=true to 'Sim'", () => {
    const r = makeReferral({ createdAt: "2025-03-10T00:00:00Z", bonusPaid: true });
    const { rows } = prepareReferrals([r] as any[], RANGE_START, RANGE_END);
    // bonusPaid column is index 7
    expect(rows[0][7]).toBe("Sim");
  });

  it("maps bonusPaid=false to 'Não'", () => {
    const r = makeReferral({ createdAt: "2025-03-10T00:00:00Z", bonusPaid: false });
    const { rows } = prepareReferrals([r] as any[], RANGE_START, RANGE_END);
    expect(rows[0][7]).toBe("Não");
  });

  it("uses referrerName when present", () => {
    const r = makeReferral({
      createdAt: "2025-03-10T00:00:00Z",
      referrerId: "u-id-1",
      referrerName: "Carlos Souza",
    });
    const { rows } = prepareReferrals([r] as any[], RANGE_START, RANGE_END);
    // Indicador column is index 2
    expect(rows[0][2]).toBe("Carlos Souza");
  });

  it("falls back to referrerId when referrerName is null", () => {
    const r = makeReferral({
      createdAt: "2025-03-10T00:00:00Z",
      referrerId: "u-id-fallback",
      referrerName: null,
    });
    const { rows } = prepareReferrals([r] as any[], RANGE_START, RANGE_END);
    expect(rows[0][2]).toBe("u-id-fallback");
  });

  it("returns empty rows when none in range", () => {
    const r = makeReferral({ createdAt: "2024-12-01T00:00:00Z" });
    const { count } = prepareReferrals([r] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
  });
});

// --------------------------------------------------------------------------
// prepareCommissions
// --------------------------------------------------------------------------

describe("prepareCommissions", () => {
  const RANGE_START = "2025-04-01";
  const RANGE_END = "2025-04-30";

  it("filters commissions by createdAt", () => {
    const inRange = makeCommission({ id: "com1", createdAt: "2025-04-10T00:00:00Z" });
    const outRange = makeCommission({ id: "com2", createdAt: "2025-05-01T00:00:00Z" });

    const { rows, count } = prepareCommissions([inRange, outRange] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(1);
    expect(rows[0][0]).toBe("com1");
  });

  it("uses sellerName in the Vendedor column when present", () => {
    const c = makeCommission({
      createdAt: "2025-04-10T00:00:00Z",
      sellerName: "Pedro Vendas",
      userId: "u-seller-1",
    });
    const { rows } = prepareCommissions([c] as any[], RANGE_START, RANGE_END);
    // Vendedor column is index 1
    expect(rows[0][1]).toBe("Pedro Vendas");
  });

  it("falls back to userId when sellerName is null", () => {
    const c = makeCommission({
      createdAt: "2025-04-10T00:00:00Z",
      sellerName: null,
      userId: "u-seller-fallback",
    });
    const { rows } = prepareCommissions([c] as any[], RANGE_START, RANGE_END);
    expect(rows[0][1]).toBe("u-seller-fallback");
  });

  it("formats baseAmount and commissionAmount as Brazilian currency", () => {
    const c = makeCommission({
      createdAt: "2025-04-10T00:00:00Z",
      baseAmount: "1000.00",
      commissionAmount: "100.00",
    });
    const { rows } = prepareCommissions([c] as any[], RANGE_START, RANGE_END);
    // baseAmount at index 4, commissionAmount at index 5
    expect(rows[0][4]).toMatch(/1\.000,00|1000,00/);
    expect(rows[0][5]).toMatch(/100,00/);
  });

  it("returns empty rows when none in range", () => {
    const c = makeCommission({ createdAt: "2024-01-01T00:00:00Z" });
    const { count } = prepareCommissions([c] as any[], RANGE_START, RANGE_END);
    expect(count).toBe(0);
  });

  it("includes the expected headers including 'Vendedor'", () => {
    const { headers } = prepareCommissions([], "2025-01-01", "2025-12-31");
    expect(headers).toContain("Vendedor");
    expect(headers).toContain("ID da Reserva");
    expect(headers).toContain("Valor Comissão (R$)");
  });
});

// --------------------------------------------------------------------------
// downloadXlsx
// --------------------------------------------------------------------------

describe("downloadXlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls aoa_to_sheet with headers prepended to rows", () => {
    const headers = ["Col A", "Col B"];
    const rows = [["v1", "v2"], ["v3", "v4"]];
    downloadXlsx(headers, rows, "test.xlsx");

    const aoaToSheet = vi.mocked(XLSX.utils.aoa_to_sheet);
    expect(aoaToSheet).toHaveBeenCalledOnce();
    const arg = aoaToSheet.mock.calls[0][0] as string[][];
    expect(arg[0]).toEqual(headers);
    expect(arg[1]).toEqual(rows[0]);
    expect(arg[2]).toEqual(rows[1]);
  });

  it("creates a new workbook and appends the sheet named 'Dados'", () => {
    downloadXlsx(["H"], [["v"]], "out.xlsx");

    expect(vi.mocked(XLSX.utils.book_new)).toHaveBeenCalledOnce();
    const bookAppendSheet = vi.mocked(XLSX.utils.book_append_sheet);
    expect(bookAppendSheet).toHaveBeenCalledOnce();
    const [, , sheetName] = bookAppendSheet.mock.calls[0];
    expect(sheetName).toBe("Dados");
  });

  it("calls XLSX.writeFile with the correct filename", () => {
    downloadXlsx(["H"], [["v"]], "clientes_20250101.xlsx");
    const writeFile = vi.mocked(XLSX.writeFile);
    expect(writeFile).toHaveBeenCalledOnce();
    const [, filename] = writeFile.mock.calls[0];
    expect(filename).toBe("clientes_20250101.xlsx");
  });
});

// --------------------------------------------------------------------------
// downloadPdf
// --------------------------------------------------------------------------

describe("downloadPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Helper: get the jsPDF doc instance created in this call */
  function getDocInstance() {
    const MockJsPDF = vi.mocked(jsPDF);
    return MockJsPDF.mock.results[0].value as {
      setFontSize: ReturnType<typeof vi.fn>;
      setFont: ReturnType<typeof vi.fn>;
      text: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
    };
  }

  it("writes the title text into the document", () => {
    downloadPdf("Relatório de Clientes", ["Coluna 1"], [["a"]], "clientes.pdf");
    const doc = getDocInstance();
    const titleCall = doc.text.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("Relatório de Clientes"),
    );
    expect(titleCall).toBeDefined();
  });

  it("calls autoTable with the correct head and body", () => {
    const headers = ["ID", "Nome"];
    const rows = [["1", "Ana"], ["2", "João"]];
    downloadPdf("Clientes", headers, rows, "test.pdf");

    const mockedAutoTable = vi.mocked(autoTable);
    expect(mockedAutoTable).toHaveBeenCalledOnce();
    const opts = mockedAutoTable.mock.calls[0][1] as { head: string[][]; body: string[][] };
    expect(opts.head).toEqual([headers]);
    expect(opts.body).toEqual(rows);
  });

  it("saves the PDF with the correct filename", () => {
    downloadPdf("Viagens", ["H"], [["v"]], "viagens_20250601.pdf");
    const doc = getDocInstance();
    expect(doc.save).toHaveBeenCalledOnce();
    expect(doc.save).toHaveBeenCalledWith("viagens_20250601.pdf");
  });

  it("sets font to bold for the title and normal for the timestamp", () => {
    downloadPdf("Título", ["H"], [["v"]], "f.pdf");
    const doc = getDocInstance();
    const boldCall = doc.setFont.mock.calls.find((c: unknown[]) => c[1] === "bold");
    const normalCall = doc.setFont.mock.calls.find((c: unknown[]) => c[1] === "normal");
    expect(boldCall).toBeDefined();
    expect(normalCall).toBeDefined();
  });

  it("starts autoTable after the header area (startY >= 28)", () => {
    downloadPdf("T", ["H"], [["v"]], "f.pdf");
    const mockedAutoTable = vi.mocked(autoTable);
    const opts = mockedAutoTable.mock.calls[0][1] as { startY: number };
    expect(opts.startY).toBeGreaterThanOrEqual(28);
  });
});

// --------------------------------------------------------------------------
// Large-volume tests — 5 000 rows (the fetch cap for quick downloads)
// --------------------------------------------------------------------------

describe("large-volume export — 5 000 rows", () => {
  const N = 5_000;
  const RANGE_START = "2020-01-01";
  const RANGE_END = "2030-12-31"; // wide range so all fixtures pass the filter

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prepareClients processes 5 000 clients without throwing and returns all rows", () => {
    const clients = Array.from({ length: N }, (_, i) => makeClient({
      id: `c${i}`,
      name: `Cliente ${i}`,
      email: `c${i}@test.com`,
      whatsapp: `119999${String(i).padStart(5, "0")}`,
      createdAt: `2025-06-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    let result: ReturnType<typeof prepareClients>;
    expect(() => {
      result = prepareClients(clients as any[], RANGE_START, RANGE_END);
    }).not.toThrow();

    expect(result!.count).toBe(N);
    expect(result!.rows).toHaveLength(N);
    // Each row must have the right number of columns
    expect(result!.rows[0]).toHaveLength(result!.headers.length);
    expect(result!.rows[N - 1]).toHaveLength(result!.headers.length);
  });

  it("prepareTrips processes 5 000 trips without throwing and returns all rows", () => {
    const trips = Array.from({ length: N }, (_, i) => makeTrip({
      id: `t${i}`,
      name: `Viagem ${i}`,
      departureDate: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`,
    }));

    let result: ReturnType<typeof prepareTrips>;
    expect(() => {
      result = prepareTrips(trips as any[], RANGE_START, RANGE_END);
    }).not.toThrow();

    expect(result!.count).toBe(N);
    expect(result!.rows[0]).toHaveLength(result!.headers.length);
  });

  it("prepareManifest expands 5 000 reservations (2 seats each) to 10 000 rows without throwing", () => {
    const reservations = Array.from({ length: N }, (_, i) => makeReservation({
      id: `r${i}`,
      seats: [`${i}A`, `${i}B`],
      trip: { name: `Viagem ${i}`, departureDate: `2025-06-${String((i % 28) + 1).padStart(2, "0")}` },
    }));

    let result: ReturnType<typeof prepareManifest>;
    expect(() => {
      result = prepareManifest(reservations as any[], RANGE_START, RANGE_END);
    }).not.toThrow();

    expect(result!.count).toBe(N * 2);
    expect(result!.rows[0]).toHaveLength(result!.headers.length);
  });

  it("prepareCommissions processes 5 000 commissions without throwing", () => {
    const commissions = Array.from({ length: N }, (_, i) => makeCommission({
      id: `com${i}`,
      sellerName: `Vendedor ${i}`,
      createdAt: `2025-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    let result: ReturnType<typeof prepareCommissions>;
    expect(() => {
      result = prepareCommissions(commissions as any[], RANGE_START, RANGE_END);
    }).not.toThrow();

    expect(result!.count).toBe(N);
    expect(result!.rows[0]).toHaveLength(result!.headers.length);
  });

  it("downloadXlsx passes all 5 000 rows to XLSX.utils.aoa_to_sheet", () => {
    const headers = ["ID", "Nome", "Valor"];
    const rows = Array.from({ length: N }, (_, i) => [`${i}`, `Item ${i}`, `${i * 10}`]);

    downloadXlsx(headers, rows, "grande_volume.xlsx");

    const aoaToSheet = vi.mocked(XLSX.utils.aoa_to_sheet);
    expect(aoaToSheet).toHaveBeenCalledOnce();
    const matrix = aoaToSheet.mock.calls[0][0] as string[][];
    // First row is headers, next N are data rows
    expect(matrix).toHaveLength(N + 1);
    expect(matrix[0]).toEqual(headers);
    expect(matrix[1]).toEqual(rows[0]);
    expect(matrix[N]).toEqual(rows[N - 1]);
    expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledWith(expect.anything(), "grande_volume.xlsx");
  });

  it("downloadPdf passes all 5 000 rows to autoTable body without throwing", () => {
    const headers = ["ID", "Nome"];
    const rows = Array.from({ length: N }, (_, i) => [`${i}`, `Linha ${i}`]);

    expect(() => {
      downloadPdf("Relatório Grande", headers, rows, "grande.pdf");
    }).not.toThrow();

    const mockedAutoTable = vi.mocked(autoTable);
    expect(mockedAutoTable).toHaveBeenCalledOnce();
    const opts = mockedAutoTable.mock.calls[0][1] as { head: string[][]; body: string[][] };
    expect(opts.body).toHaveLength(N);
    expect(opts.body[0]).toEqual(rows[0]);
    expect(opts.body[N - 1]).toEqual(rows[N - 1]);

    const MockJsPDF = vi.mocked(jsPDF);
    const doc = MockJsPDF.mock.results[0].value as { save: ReturnType<typeof vi.fn> };
    expect(doc.save).toHaveBeenCalledWith("grande.pdf");
  });
});

// --------------------------------------------------------------------------
// fmtDate / fmtCur — quick sanity checks
// --------------------------------------------------------------------------

describe("fmtDate", () => {
  it("formats ISO date string as dd/MM/yyyy", () => {
    expect(fmtDate("2025-06-15T00:00:00Z")).toBe("15/06/2025");
  });

  it("returns empty string for null", () => {
    expect(fmtDate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(fmtDate(undefined)).toBe("");
  });
});

describe("fmtCur", () => {
  it("formats a number with Brazilian decimal separator", () => {
    expect(fmtCur(1500)).toMatch(/1\.500,00|1500,00/);
  });

  it("returns '0,00' for null", () => {
    expect(fmtCur(null)).toBe("0,00");
  });

  it("formats a string number correctly", () => {
    expect(fmtCur("800.50")).toMatch(/800,50/);
  });
});

// --------------------------------------------------------------------------
// Downloads page — empty filtered result
// --------------------------------------------------------------------------

const fetchHost = globalThis as unknown as { fetch?: unknown };
let originalFetch: unknown;

function getQuickDownloadButton(
  container: HTMLElement,
  cardLabel: string,
  format: "XLSX" | "PDF",
): HTMLButtonElement {
  const title = Array.from(container.querySelectorAll("div")).find(
    (element) => element.textContent?.trim() === cardLabel,
  );
  const card = title?.closest(".rounded-xl");
  const button = Array.from(card?.querySelectorAll("button") ?? []).find(
    (element) => element.textContent?.trim() === format,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find ${format} quick-download button for ${cardLabel}`);
  }
  return button;
}

describe("Downloads — empty quick-download result", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-20T12:00:00Z"));
    mockToast.mockClear();
    vi.mocked(XLSX.writeFile).mockClear();
    vi.mocked(jsPDF).mockClear();

    originalFetch = fetchHost.fetch;
    fetchHost.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        data: [{ id: "client-outside-range", createdAt: "2024-01-15T00:00:00Z" }],
        total: 1,
      }),
    });
  });

  afterEach(async () => {
    await cleanupRoots();
    fetchHost.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("shows the empty-state toast and does not start XLSX or PDF downloads", async () => {
    const { container } = await renderComponent(createElement(Downloads));

    const xlsxButton = getQuickDownloadButton(container, "Clientes", "XLSX");
    await flushAct(async () => {
      xlsxButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToast).toHaveBeenNthCalledWith(1, {
      title: "Sem dados de Clientes para exportar no período",
    });
    expect(vi.mocked(XLSX.writeFile)).not.toHaveBeenCalled();

    const pdfButton = getQuickDownloadButton(container, "Clientes", "PDF");
    await flushAct(async () => {
      pdfButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToast).toHaveBeenNthCalledWith(2, {
      title: "Sem dados de Clientes para exportar no período",
    });
    expect(vi.mocked(jsPDF)).not.toHaveBeenCalled();
    const createdPdfDocs = vi.mocked(jsPDF).mock.results.map(
      (result) => result.value as { save: ReturnType<typeof vi.fn> },
    );
    expect(createdPdfDocs.every((doc) => !doc.save.mock.calls.length)).toBe(true);
  });
});
