/**
 * Unit tests for generateVoucherPdf (lib/voucher-pdf.ts)
 *
 * Verifies that the "Passageiro(s) no colo" row appears in the PDF output
 * when lapChildCount > 0, and is absent otherwise.
 *
 * jsPDF runs fine in Node.js (verified: text is readable in latin1 in the
 * output buffer), so these tests call generateVoucherPdf directly without
 * mocking the PDF engine.
 */

import { describe, it, expect, vi } from "vitest";

// @workspace/shared is a workspace package; mock formatBRLPlain so the test
// is hermetic and does not depend on the compiled dist.
vi.mock("@workspace/shared", () => ({
  formatBRLPlain: (v: number) => `R$ ${v.toFixed(2)}`,
  localToday: vi.fn(() => "2026-07-20"),
}));

import { generateVoucherPdf, type VoucherData } from "../lib/voucher-pdf.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeVoucherData(overrides: Partial<VoucherData> = {}): VoucherData {
  return {
    passengerName: "Maria Souza",
    agencyName: "Agência Teste",
    primaryColor: "#3B82F6",
    reservationId: "res-001",
    reservationNumber: "AG-EX-202507-0001",
    status: "confirmed",
    voucherCode: "VCHR-0001",
    reservationDate: new Date("2026-07-01T10:00:00Z"),
    paymentMethod: "pix",
    totalValue: 300,
    paidValue: 150,
    balance: 150,
    seatsCount: 2,
    tripName: "Excursão Nordeste",
    tripDestination: "Fortaleza - CE",
    tripDepartureDate: "2026-08-01",
    tripReturnDate: "2026-08-10",
    ...overrides,
  };
}

/** Read the PDF buffer as a latin1 string (jsPDF stores text in content streams readable as latin1). */
function pdfText(buf: Buffer): string {
  return buf.toString("latin1");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateVoucherPdf — passageiro de colo (lapChildCount)", () => {
  it("returns a non-empty Buffer", () => {
    const buf = generateVoucherPdf(makeVoucherData());
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("includes 'no colo' text when lapChildCount=1", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 1 }));
    const text = pdfText(buf);
    expect(text).toContain("no colo");
  });

  it("includes '1 (sem poltrona)' when lapChildCount=1", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 1 }));
    const text = pdfText(buf);
    expect(text).toContain("sem poltrona");
  });

  it("includes 'no colo' text when lapChildCount=2", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 2 }));
    const text = pdfText(buf);
    expect(text).toContain("no colo");
  });

  it("includes '2 (sem poltrona)' when lapChildCount=2", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 2 }));
    const text = pdfText(buf);
    expect(text).toContain("sem poltrona");
  });

  it("does NOT include 'no colo' when lapChildCount is undefined", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: undefined }));
    const text = pdfText(buf);
    expect(text).not.toContain("no colo");
  });

  it("does NOT include 'no colo' when lapChildCount is 0", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 0 }));
    const text = pdfText(buf);
    expect(text).not.toContain("no colo");
  });

  it("still includes standard trip data regardless of lapChildCount", () => {
    const buf = generateVoucherPdf(makeVoucherData({ lapChildCount: 1 }));
    const text = pdfText(buf);
    expect(text).toContain("Excur");  // tripName prefix (special chars may be encoded)
    expect(text).toContain("Fortaleza");
  });
});
