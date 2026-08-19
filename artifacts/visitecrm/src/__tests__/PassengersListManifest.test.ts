/**
 * PassengersListManifest — bebê de colo (isOnLap)
 *
 * Verifica que passageiros com ageCategory="baby" e seatNumber=null:
 * 1. São contados na categoria "Gratuidades" do manifesto ANTT
 *    (anttBucket: baby → "gratuidade")
 * 2. Exibem "—" na coluna Poltrona (seatNumber null → "—")
 * 3. NÃO entram nas categorias Adultos ou Crianças
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/api-client-react", () => ({}));

import { printPassengersManifest } from "../pages/trips/PassengersListManifest.js";
import type { BoardingPassenger } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGE_CATEGORY_LABELS: Record<string, string> = {
  adult: "Adulto",
  child: "Criança",
  senior: "Idoso",
  baby: "Bebê",
  pcd: "PCD",
};

function noLabel(_id: string | null | undefined): string {
  return "";
}

function noCpf(_cpf: string | null | undefined): string {
  return "";
}

function makeLapChild(overrides: Partial<BoardingPassenger> = {}): BoardingPassenger {
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
    ...overrides,
  } as BoardingPassenger;
}

function makeAdult(overrides: Partial<BoardingPassenger> = {}): BoardingPassenger {
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
    ...overrides,
  } as BoardingPassenger;
}

// ---------------------------------------------------------------------------
// Window mock
// ---------------------------------------------------------------------------

function setupWindowOpenCapture(): { getHtml: () => string } {
  let capturedHtml = "";
  vi.spyOn(window, "open").mockImplementation(() => {
    const mockDoc = {
      write: (html: string) => { capturedHtml = html; },
      close: vi.fn(),
    };
    return {
      document: mockDoc,
      focus: vi.fn(),
      print: vi.fn(),
    } as unknown as Window & typeof globalThis;
  });
  return { getHtml: () => capturedHtml };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("printPassengersManifest — anttBucket: baby → gratuidade", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("conta passageiro com ageCategory='baby' em Gratuidades no totalizador", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    const html = getHtml();
    // The totals row renders: <strong>Gratuidades:</strong> 1
    expect(html).toContain("Gratuidades:</strong> 1</span>");
  });

  it("não inclui bebê de colo nos totais de Adultos", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).not.toContain("Adultos:");
  });

  it("não inclui bebê de colo nos totais de Crianças", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).not.toContain("Crianças:");
  });

  it("conta separadamente adulto e bebê de colo nos totais corretos", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult(), makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    const html = getHtml();
    expect(html).toContain("Adultos:");
    expect(html).toContain("Gratuidades:");
    // Each category must appear exactly once with count 1
    expect(html).not.toContain("Adultos:</strong> 2");
    expect(html).not.toContain("Gratuidades:</strong> 2");
  });
});

describe("printPassengersManifest — badge 'No colo' na coluna de observações", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adiciona 'No colo' na célula de observações para bebê de colo (seatNumber=null)", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).toContain("No colo");
  });

  it("não adiciona 'No colo' para adulto com poltrona atribuída", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).not.toContain("No colo");
  });

  it("não adiciona 'No colo' para bebê com poltrona atribuída (seatNumber preenchido)", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild({ seatNumber: "01A" })],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).not.toContain("No colo");
  });
});

describe("printPassengersManifest — coluna Poltrona com seatNumber=null", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exibe '—' na célula Poltrona quando seatNumber é null", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    // The seat cell: <td class="seat">—</td>
    expect(getHtml()).toContain('<td class="seat">—</td>');
  });

  it("exibe o número da poltrona quando seatNumber está preenchido", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).toContain('<td class="seat">12A</td>');
    expect(getHtml()).not.toContain('<td class="seat">—</td>');
  });

  it("exibe a categoria 'Bebê' na coluna Cat. para passageiros de colo", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).toContain("Bebê");
  });
});
