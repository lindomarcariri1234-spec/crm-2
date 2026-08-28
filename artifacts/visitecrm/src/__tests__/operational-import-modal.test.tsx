import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationalImportModal, sanitizeImportFailureCell } from "../components/operational-import-modal";
import {
  IMPORT_MAX_FILE_BYTES,
  normalizeSpreadsheetHeader,
  readSpreadsheetPreview,
} from "../lib/spreadsheet-import-preview";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness";

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const contract = {
  version: 1,
  columns: [
    { key: "id_externo", label: "ID Externo", required: true, format: "texto", example: "CLI-1" },
    { key: "nome", label: "Nome", required: true, format: "texto", example: "Maria" },
  ],
  dependencies: [],
  derivedFieldsExcluded: [],
};

const previewReport = {
  entity: "clients",
  contractVersion: 1,
  filename: "clientes.csv",
  totalRows: 2,
  results: [
    { line: 2, sourceKey: "CLI-1", action: "created" },
    { line: 3, sourceKey: "CLI-2", action: "rejected", reason: "CPF duplicado." },
  ],
};

function response(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 20));
  await Promise.resolve();
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(item =>
    item.textContent?.includes(label),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Botão não encontrado: ${label}`);
  return found;
}

describe("prévia local de importação", () => {
  it.each(["=2+2", "+cmd", "-10+20", "@SUM(A1)", "  =HYPERLINK(\"x\")"])(
    "neutraliza fórmulas perigosas no CSV de falhas: %s",
    value => {
      expect(sanitizeImportFailureCell(value)).toBe(`'${value}`);
    },
  );

  it("normaliza cabeçalhos, preserva linhas e rejeita extensões inválidas", async () => {
    const file = new File(
      ["ID Externo,Nome\nCLI-1,Maria\nCLI-2,João"],
      "clientes.csv",
      { type: "text/csv" },
    );
    const parsed = await readSpreadsheetPreview(file);
    expect(parsed.headers).toEqual(["ID Externo", "Nome"]);
    expect(parsed.normalizedHeaders).toEqual(["id_externo", "nome"]);
    expect(parsed.rows).toHaveLength(2);
    expect(normalizeSpreadsheetHeader("Data de Saída")).toBe("data_de_saida");

    await expect(readSpreadsheetPreview(new File(["x"], "dados.pdf"))).rejects.toThrow("CSV ou XLSX");
  });

  it("bloqueia arquivos maiores que o limite antes de chamar o servidor", async () => {
    const file = new File(["x"], "clientes.csv");
    Object.defineProperty(file, "size", { value: IMPORT_MAX_FILE_BYTES + 1 });
    await expect(readSpreadsheetPreview(file)).rejects.toThrow("5 MB");
  });
});

describe("OperationalImportModal", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockToast.mockClear();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await cleanupRoots();
    document.body.innerHTML = "";
  });

  it("faz prévia sem gravar, confirma uma vez e oferece o CSV de falhas", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/contracts/")) return response(contract);
      if (url.endsWith("/preview")) return response({ report: previewReport });
      if (url.endsWith("/import")) return response({ report: previewReport, replayed: false });
      return response({}, false);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const onImported = vi.fn();

    await renderComponent(createElement(OperationalImportModal, {
      entity: "clients",
      title: "Importar clientes",
      open: true,
      onClose: vi.fn(),
      onImported,
    }));
    await flushAct(settle);

    const input = document.body.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(
      ["id_externo,nome\nCLI-1,Maria\nCLI-2,João"],
      "clientes.csv",
      { type: "text/csv" },
    );
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await flushAct(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(document.body.textContent).toContain("Colunas reconhecidas: ID Externo, Nome");
    expect(document.body.textContent).toContain("1 duplicado(s)");
    expect(onImported).not.toHaveBeenCalled();

    const confirm = button("Confirmar importação");
    await flushAct(async () => {
      confirm.click();
      confirm.click();
      await settle();
    });

    const importCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/import"));
    expect(importCalls).toHaveLength(1);
    expect(onImported).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Relatório da importação");
    expect(button("Confirmar importação").disabled).toBe(true);

    const createObjectURL = vi.fn().mockReturnValue("blob:failures");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await flushAct(() => button("Baixar falhas").click());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    anchorClick.mockRestore();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
  });

  it("mantém a prévia disponível quando a gravação falha totalmente", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contracts/")) return response(contract);
      if (url.endsWith("/preview")) return response({ report: previewReport });
      return response({ error: "Falha total de gravação" }, false);
    }) as typeof fetch;

    await renderComponent(createElement(OperationalImportModal, {
      entity: "clients",
      title: "Importar clientes",
      open: true,
      onClose: vi.fn(),
      onImported: vi.fn(),
    }));
    await flushAct(settle);
    const input = document.body.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["id_externo,nome\nCLI-1,Maria"], "clientes.csv", { type: "text/csv" })],
    });
    await flushAct(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });
    await flushAct(async () => {
      button("Confirmar importação").click();
      await settle();
    });

    expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: "Erro na importação",
      description: "Falha total de gravação",
    }));
    expect(button("Confirmar importação").disabled).toBe(false);
  });

  it("explica e bloqueia a confirmação quando o mesmo arquivo já foi importado", async () => {
    const ignoredReport = {
      ...previewReport,
      results: previewReport.results.map(row => ({
        ...row,
        action: "ignored",
        reason: "Mesmo arquivo já importado.",
      })),
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contracts/")) return response(contract);
      if (url.endsWith("/preview")) return response({ report: ignoredReport });
      return response({ report: ignoredReport });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await renderComponent(createElement(OperationalImportModal, {
      entity: "clients",
      title: "Importar clientes",
      open: true,
      onClose: vi.fn(),
      onImported: vi.fn(),
    }));
    await flushAct(settle);
    const input = document.body.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["id_externo,nome\nCLI-1,Maria"], "clientes.csv", { type: "text/csv" })],
    });
    await flushAct(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });

    expect(document.body.textContent).toContain("Este arquivo já foi importado");
    expect(button("Confirmar importação").disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/import"))).toHaveLength(0);
  });
});