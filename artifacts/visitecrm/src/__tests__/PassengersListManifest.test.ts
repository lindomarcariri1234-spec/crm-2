/**
 * PassengersListManifest — totais por categoria e gratuidade
 *
 * Categorias etárias e gratuidade são dimensões independentes no resumo:
 * bebês e adultos gratuitos permanecem em suas respectivas categorias,
 * enquanto também compõem o total de gratuidades.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/api-client-react", () => ({}));

import { printPassengersManifest } from "../pages/trips/PassengersListManifest.js";
import type { BoardingPassenger, FreePassenger } from "@workspace/api-client-react";

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

function makeChild(overrides: Partial<BoardingPassenger> = {}): BoardingPassenger {
  return {
    ...makeAdult(),
    id: "pax-child-001",
    reservationId: "res-child-001",
    voucherCode: "VCHR-CHILD-001",
    clientName: "Criança Silva",
    name: "Criança Silva",
    ageCategory: "child",
    ...overrides,
  } as BoardingPassenger;
}

function makeFreePassenger(overrides: Partial<FreePassenger> = {}): FreePassenger {
  return {
    id: "free-001",
    name: "Guia Cortesia",
    cpf: null,
    role: "guide",
    seatNumber: null,
    ...overrides,
  } as FreePassenger;
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

describe("printPassengersManifest — totais por categoria e gratuidade", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("conta bebê de colo em Bebê e Gratuidades", () => {
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
    expect(html).toContain("Bebê:</strong> 1</span>");
    expect(html).toContain("Gratuidades:</strong> 1</span>");
  });

  it("não inclui bebê de colo nos totais de Adultos ou Crianças", () => {
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
    expect(html).not.toContain("Adultos:");
    expect(html).not.toContain("Crianças:");
  });

  it("mantém adultos gratuitos na categoria Adultos e soma gratuidades independentes", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult({ isGratuidade: true }), makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    const html = getHtml();
    expect(html).toContain("Adultos:</strong> 1</span>");
    expect(html).toContain("Bebê:</strong> 1</span>");
    expect(html).toContain("Gratuidades:</strong> 2</span>");
  });

  it("mostra o resumo completo solicitado sem duplicar o total da lista", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [
        makeAdult({ id: "adult-1" }),
        makeAdult({ id: "adult-2" }),
        makeAdult({ id: "adult-3", isGratuidade: true }),
        makeChild(),
        makeLapChild(),
      ],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    const html = getHtml();
    expect(html).toContain("Adultos:</strong> 3</span>");
    expect(html).toContain("Crianças:</strong> 1</span>");
    expect(html).toContain("Bebê:</strong> 1</span>");
    expect(html).toContain("Gratuidades:</strong> 2</span>");
    expect(html).toContain("Lista de Passageiros (5)");
  });

  it("inclui gratuidades cadastradas à parte sem alterar categorias etárias", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
      [makeFreePassenger()],
    );

    const html = getHtml();
    expect(html).toContain("Adultos:</strong> 1</span>");
    expect(html).toContain("Gratuidades:</strong> 1</span>");
    expect(html).toContain("Lista de Passageiros (2)");
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

  it("exibe 'No colo' na célula Poltrona quando seatNumber é null", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeLapChild()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
    );

    expect(getHtml()).toContain('<td class="seat">No colo</td>');
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
    expect(getHtml()).not.toContain('<td class="seat">No colo</td>');
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

describe("printPassengersManifest — colunas financeiras", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("imprime os valores financeiros formatados quando as colunas estão visíveis", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult({
        totalValue: "1234.5",
        paidValue: "800",
        balance: "434.5",
      })],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
      [],
      { totalValue: true, paidValue: true, balance: true },
    );

    const html = getHtml();
    expect(html).toContain('<th class="num">Valor Total</th>');
    expect(html).toContain('<th class="num">Valor Pago</th>');
    expect(html).toContain('<th class="num">Saldo</th>');
    expect(html).toContain("R$ 1.234,50");
    expect(html).toContain("R$ 800,00");
    expect(html).toContain("R$ 434,50");
  });

  it("não imprime os cabeçalhos financeiros quando as colunas estão ocultas", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [makeAdult()],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
      [],
      { totalValue: false, paidValue: false, balance: false },
    );

    const html = getHtml();
    expect(html).not.toContain('<th class="num">Valor Total</th>');
    expect(html).not.toContain('<th class="num">Valor Pago</th>');
    expect(html).not.toContain('<th class="num">Saldo</th>');
    expect(html).not.toContain('class="financial-totals"');
  });

  it("inclui os totais financeiros no rodapé e ignora gratuidades", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [
        makeAdult({ totalValue: "100", paidValue: "25", balance: "75" }),
        makeAdult({
          id: "adult-free",
          isGratuidade: true,
          totalValue: "999",
          paidValue: "999",
          balance: "0",
        }),
      ],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
      [],
      { totalValue: true, paidValue: true, balance: true },
    );

    const html = getHtml();
    expect(html).toContain('<tfoot><tr class="financial-totals">');
    expect(html).toContain("Totais");
    expect(html).toContain("R$ 100,00");
    expect(html).toContain("R$ 25,00");
    expect(html).toContain("R$ 75,00");
    expect(html).toContain('class="num positive-balance"');
    const totalsFooter = html.match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0] ?? "";
    expect(totalsFooter).not.toContain("R$ 999,00");
  });

  it("imprime — nas três colunas financeiras para gratuidades cadastradas à parte", () => {
    const { getHtml } = setupWindowOpenCapture();

    printPassengersManifest(
      undefined,
      undefined,
      [],
      noLabel,
      noCpf,
      AGE_CATEGORY_LABELS,
      [makeFreePassenger()],
      { totalValue: true, paidValue: true, balance: true },
    );

    const html = getHtml();
    expect(html).toContain('<th class="num">Valor Total</th>');
    expect(html).toContain('<th class="num">Valor Pago</th>');
    expect(html).toContain('<th class="num">Saldo</th>');
    expect(html.match(/<td class="num">—<\/td>/g)).toHaveLength(3);
  });
});
