import { describe, it, expect, vi, afterEach } from "vitest";
import PDFDocument from "pdfkit";
import {
  generateManifestHtml,
  generateManifestPdf,
  escapeHtmlServer,
  formatCpfServer,
  seatWithPosition,
  type ManifestPanel,
} from "./manifest-helpers.js";

const basePanel = (): ManifestPanel => ({
  tripName: "Viagem Natal 2026",
  departureDate: "2026-07-04T15:00:00.000Z",
  departureTime: "08:30",
  tenantName: "Agência Teste",
  tenantCnpj: null,
  manifestNumber: null,
  vehiclePlate: null,
  vehicleType: null,
  driverName: null,
  driver1Cpf: null,
  driver1Cnh: null,
  driver1CnhCategory: null,
  driver1CnhExpiry: null,
  driver2Name: null,
  driver2Cpf: null,
  driver2Cnh: null,
  driver2CnhCategory: null,
  driver2CnhExpiry: null,
  tourGuide: null,
  tourGuideCpf: null,
  tourGuideRegistration: null,
  boardingPoints: [],
  passengers: [],
  freePassengers: [],
});

// ─── generateManifestHtml ─────────────────────────────────────────────────────

describe("generateManifestHtml", () => {
  describe("departure date display", () => {
    it("formats departureDate stored as UTC noon Brazil time to dd/MM/yyyy", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).toContain("04/07/2026");
    });

    it("does NOT expose raw ISO timestamp in the departure field", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).not.toContain("2026-07-04T");
    });

    it("renders empty departure date when departureDate is empty string", () => {
      const html = generateManifestHtml({ ...basePanel(), departureDate: "" });
      expect(html).toContain("<label>Saída:</label>");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    });
  });

  describe("departure time display", () => {
    it("shows departureTime value as-is (from stored field, not extracted from timestamp)", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).toContain("às 08:30");
    });

    it("does NOT show the UTC time extracted from the departure timestamp", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).not.toContain("às 15:00");
      expect(html).not.toContain("às 00:00");
    });

    it("omits the time suffix when departureTime is null", () => {
      const html = generateManifestHtml({ ...basePanel(), departureTime: null });
      expect(html).not.toContain("às");
    });

    it("shows date only (no time) when departureTime is null", () => {
      const html = generateManifestHtml({ ...basePanel(), departureTime: null });
      expect(html).toContain("<label>Saída:</label>04/07/2026");
    });

    it("shows both date and time when both are provided", () => {
      const html = generateManifestHtml({ ...basePanel(), departureTime: "14:45" });
      expect(html).toContain("04/07/2026 às 14:45");
    });
  });

  describe("category totals row (removed)", () => {
    it("does not render any category totals line in the manifest", () => {
      const html = generateManifestHtml({
        ...basePanel(),
        passengers: [
          { name: "Lindomar", cpf: null, birthDate: null, ageCategory: "baby", seatNumber: "1", boardingLocationId: null, documentType: null, specialNeeds: null, observations: null },
          { name: "Iracy",    cpf: null, birthDate: null, ageCategory: "baby", seatNumber: null, boardingLocationId: null, documentType: null, specialNeeds: null, observations: null },
          { name: "Vanessa",  cpf: null, birthDate: null, ageCategory: "adult", seatNumber: "4", boardingLocationId: null, documentType: null, specialNeeds: null, observations: null },
        ],
      });
      expect(html).not.toContain("Adultos:");
      expect(html).not.toContain("Gratuidades:");
      expect(html).not.toContain("No colo:");
      expect(html).not.toContain("Totais por categoria");
    });
  });

  describe("HTML structure", () => {
    it("produces valid HTML with DOCTYPE", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain("</html>");
    });

    it("includes trip name in title and body", () => {
      const html = generateManifestHtml(basePanel());
      expect(html).toContain("Viagem Natal 2026");
    });

    it("escapes HTML special characters in trip name", () => {
      const html = generateManifestHtml({
        ...basePanel(),
        tripName: 'Viagem <Script> & "Teste"',
      });
      expect(html).toContain("&lt;Script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;Teste&quot;");
      expect(html).not.toContain("<Script>");
    });

    it("shows manifest number when provided", () => {
      const html = generateManifestHtml({ ...basePanel(), manifestNumber: "MAN-0042" });
      expect(html).toContain("MAN-0042");
    });

    it("renders passenger rows with seat and boarding info", () => {
      const panel: ManifestPanel = {
        ...basePanel(),
        boardingPoints: [{ id: "bp1", name: "Terminal Central" }],
        passengers: [
          {
            name: "João Silva",
            cpf: "12345678901",
            birthDate: null,
            ageCategory: "adult",
            seatNumber: "15",
            boardingLocationId: "bp1",
            documentType: null,
            specialNeeds: null,
            observations: null,
          },
        ],
      };
      const html = generateManifestHtml(panel);
      expect(html).toContain("João Silva");
      expect(html).toContain("123.456.789-01");
      expect(html).toContain("Terminal Central");
      expect(html).toContain("Adulto");
    });
  });
});

// ─── generateManifestPdf ─────────────────────────────────────────────────────

describe("generateManifestPdf", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves with a non-empty Buffer", async () => {
    const buf = await generateManifestPdf(basePanel());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("produces a valid PDF (starts with %PDF-)", async () => {
    const buf = await generateManifestPdf(basePanel());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders departure date as dd/MM/yyyy in the PDF", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "text");
    const buf = await generateManifestPdf(basePanel());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const rendered = spy.mock.calls
      .map(call => (typeof call[0] === "string" ? call[0] : ""))
      .join(" ");
    expect(rendered).toContain("04/07/2026");
  });

  it("renders departureTime from the stored field, not extracted from the ISO timestamp", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "text");
    const buf = await generateManifestPdf(basePanel());
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const rendered = spy.mock.calls
      .map(call => (typeof call[0] === "string" ? call[0] : ""))
      .join(" ");
    expect(rendered).toContain("08:30");
    expect(rendered).not.toContain("15:00");
  });

  it("omits time suffix in PDF when departureTime is null", async () => {
    const spy = vi.spyOn(PDFDocument.prototype as any, "text");
    const buf = await generateManifestPdf({ ...basePanel(), departureTime: null });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const rendered = spy.mock.calls
      .map(call => (typeof call[0] === "string" ? call[0] : ""))
      .join(" ");
    expect(rendered).toContain("04/07/2026");
    expect(rendered).not.toContain("às");
  });

  it("resolves without error when passengers list is empty", async () => {
    const buf = await generateManifestPdf({ ...basePanel(), passengers: [] });
    expect(buf.length).toBeGreaterThan(0);
  });

  it("resolves without error with multiple passengers", async () => {
    const panel: ManifestPanel = {
      ...basePanel(),
      boardingPoints: [{ id: "bp1", name: "Terminal" }],
      passengers: [
        {
          name: "Maria Souza",
          cpf: "98765432100",
          birthDate: "1990-03-15",
          ageCategory: "adult",
          seatNumber: "5",
          boardingLocationId: "bp1",
          documentType: null,
          specialNeeds: null,
          observations: null,
        },
        {
          name: "Pedro Lima",
          cpf: null,
          birthDate: null,
          ageCategory: "child",
          seatNumber: "6",
          boardingLocationId: null,
          documentType: null,
          specialNeeds: null,
          observations: null,
        },
      ],
    };
    const buf = await generateManifestPdf(panel);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

// ─── helper units ─────────────────────────────────────────────────────────────

describe("escapeHtmlServer", () => {
  it("escapes ampersand", () => expect(escapeHtmlServer("A & B")).toBe("A &amp; B"));
  it("escapes less-than", () => expect(escapeHtmlServer("<b>")).toBe("&lt;b&gt;"));
  it("escapes double-quote", () => expect(escapeHtmlServer('"hi"')).toBe("&quot;hi&quot;"));
  it("escapes single-quote", () => expect(escapeHtmlServer("it's")).toBe("it&#039;s"));
  it("leaves plain text unchanged", () => expect(escapeHtmlServer("hello")).toBe("hello"));
});

describe("formatCpfServer", () => {
  it("formats 11-digit CPF string", () => expect(formatCpfServer("12345678901")).toBe("123.456.789-01"));
  it("formats CPF with non-digit chars already present", () => expect(formatCpfServer("123.456.789-01")).toBe("123.456.789-01"));
  it("returns em-dash for null", () => expect(formatCpfServer(null)).toBe("—"));
  it("returns em-dash for undefined", () => expect(formatCpfServer(undefined)).toBe("—"));
});

describe("seatWithPosition", () => {
  it("returns em-dash for null seat", () => expect(seatWithPosition(null)).toBe("—"));
  it("returns seat as-is without brazilian_standard numbering", () => expect(seatWithPosition("12", "sequential")).toBe("12"));
  it("labels odd seats as Janela in brazilian_standard", () => expect(seatWithPosition("3", "brazilian_standard")).toBe("3 (Janela)"));
  it("labels even seats as Corredor in brazilian_standard", () => expect(seatWithPosition("4", "brazilian_standard")).toBe("4 (Corredor)"));
  it("returns seat as-is for non-numeric with brazilian_standard", () => expect(seatWithPosition("ABC", "brazilian_standard")).toBe("ABC"));
});
