import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { Client } from "@workspace/api-client-react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockUseListClients = vi.hoisted(() => vi.fn());
const mockUseListDestinations = vi.hoisted(() => vi.fn());
const mockListClients = vi.hoisted(() => vi.fn());
const mockRefetchClients = vi.hoisted(() => vi.fn());
const mockRefetchDestinations = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockCreateObjectURL = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => "blob:clients-csv"),
);
const mockRevokeObjectURL = vi.hoisted(() => vi.fn());
const mockAnchorClick = vi.hoisted(() => vi.fn());
const mockMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalAnchorClick = HTMLAnchorElement.prototype.click;

vi.mock("wouter", () => ({
  useLocation: () => ["/clients", vi.fn()],
  useSearch: () => "",
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: vi.fn(() => mockMutation),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

vi.mock("@workspace/api-client-react", () => ({
  listClients: mockListClients,
  useListClients: mockUseListClients,
  useListDestinations: mockUseListDestinations,
  useListPipelineStages: vi.fn(() => ({ data: [] })),
  useListTrips: vi.fn(() => ({ data: { data: [] } })),
  useListAccommodations: vi.fn(() => ({ data: [] })),
  useListReservations: vi.fn(() => ({ data: { data: [] } })),
  useListPassengers: vi.fn(() => ({ data: [] })),
  useGetReservationRoomAssignments: vi.fn(() => ({ data: [] })),
  useGetTripRoomAllocationSummary: vi.fn(() => ({ data: null, isLoading: false })),
  useListUsers: vi.fn(() => ({ data: [] })),
  useListPayments: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useGetMe: vi.fn(() => ({ data: null })),
  useCreateClient: vi.fn(() => mockMutation),
  useUpdateClient: vi.fn(() => mockMutation),
  useCreateDeal: vi.fn(() => mockMutation),
  useCreateReservation: vi.fn(() => mockMutation),
  useUpdateReservation: vi.fn(() => mockMutation),
  useUpdateReservationRoomAssignments: vi.fn(() => mockMutation),
  useCalculateCommission: vi.fn(() => ({ data: undefined })),
  useDeleteClient: vi.fn(() => mockMutation),
  useCreateDestination: vi.fn(() => mockMutation),
  useUpdateDestination: vi.fn(() => mockMutation),
  useDeleteDestination: vi.fn(() => mockMutation),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/client360-modal", () => ({
  Client360Modal: () => null,
}));

vi.mock("@/components/SeatMapPicker", () => ({
  SeatMapPicker: () => null,
}));

vi.mock("@/components/plan-limit-wall", () => ({
  PlanLimitWall: () => null,
  usePlanLimitError: () => null,
}));

vi.mock("@/components/operational-import-modal", () => ({
  OperationalImportModal: () => null,
}));

import Clients from "../pages/clients.js";
import Destinos from "../pages/cadastros/destinos.js";
import { QueryErrorState } from "../components/query-error-state.js";

afterEach(async () => {
  await cleanupRoots();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectURL,
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: originalAnchorClick,
  });
  vi.clearAllMocks();
  mockListClients.mockReset();
});

function configureClientList({
  isError,
  data = [],
  total = data.length,
}: {
  isError: boolean;
  data?: unknown[];
  total?: number;
}) {
  mockUseListClients.mockReturnValue({
    data: isError ? undefined : { data, total },
    isLoading: false,
    isError,
    error: isError ? new Error("Falha simulada na API de clientes") : null,
    refetch: mockRefetchClients,
  });
  mockUseQuery.mockReturnValue({
    data: { pairs: [], total: 0 },
    isLoading: false,
    error: null,
  });
}

function configureDestinationList({
  isError,
  data = [],
}: {
  isError: boolean;
  data?: unknown[];
}) {
  mockUseListDestinations.mockReturnValue({
    data,
    isError,
    error: isError ? new Error("Falha simulada na API de destinos") : null,
    refetch: mockRefetchDestinations,
  });
}

function makeExportClient(id: number): Client {
  const suffix = String(id).padStart(4, "0");
  return {
    id: `client-${suffix}`,
    name: `Cliente ${suffix}`,
    email: `cliente-${suffix}@example.test`,
    whatsapp: null,
    classification: "lead",
    status: "active",
    tags: [],
    pipelineStage: "Lead",
    totalSpent: 0,
    outstandingBalance: 0,
    dreamDestinations: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function parseExportedClientNames(csv: string): string[] {
  return csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(1)
    .map((row) => row.slice(1, row.indexOf('",')));
}

async function clickExportClients() {
  const { container } = await renderComponent(createElement(Clients));
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="button-export-clients-csv"]',
  );
  expect(button).not.toBeNull();

  await flushAct(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("proteção contra estados vazios silenciosos", () => {
  it("mostra erro e retry na página de clientes sem exibir cadastro vazio", async () => {
    configureClientList({ isError: true });

    const handle = await renderComponent(createElement(Clients));

    expect(handle.container.textContent).toContain("Não foi possível carregar os clientes.");
    expect(handle.container.textContent).toContain("Tentar novamente");
    expect(handle.container.textContent).not.toContain("Nenhum cliente cadastrado.");

    const retry = Array.from(handle.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Tentar novamente"));
    expect(retry).toBeDefined();

    await flushAct(() => retry!.click());
    expect(mockRefetchClients).toHaveBeenCalled();
  });

  it("mantém o estado vazio legítimo na página de clientes", async () => {
    configureClientList({ isError: false });

    const handle = await renderComponent(createElement(Clients));

    expect(handle.container.textContent).toContain("Nenhum cliente cadastrado.");
    expect(handle.container.textContent).not.toContain("Não foi possível carregar os clientes.");
  });

  it("mostra erro e retry na página de destinos sem exibir destino vazio", async () => {
    configureDestinationList({ isError: true });

    const handle = await renderComponent(createElement(Destinos));

    expect(handle.container.textContent).toContain("Não foi possível carregar os destinos.");
    expect(handle.container.textContent).toContain("Tentar novamente");
    expect(handle.container.textContent).not.toContain("Nenhum destino encontrado");

    const retry = Array.from(handle.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Tentar novamente"));
    expect(retry).toBeDefined();

    await flushAct(() => retry!.click());
    expect(mockRefetchDestinations).toHaveBeenCalledTimes(1);
  });

  it("mantém o estado vazio legítimo na página de destinos", async () => {
    configureDestinationList({ isError: false });

    const handle = await renderComponent(createElement(Destinos));

    expect(handle.container.textContent).toContain("Nenhum destino encontrado");
    expect(handle.container.textContent).not.toContain("Não foi possível carregar os destinos.");
  });
});

describe("exportação CSV da página de clientes", () => {
  beforeEach(() => {
    mockListClients.mockReset();
    mockToast.mockReset();
    mockCreateObjectURL.mockReset().mockReturnValue("blob:clients-csv");
    mockRevokeObjectURL.mockReset();
    mockAnchorClick.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mockCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mockRevokeObjectURL,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: mockAnchorClick,
    });
    configureClientList({ isError: false });
  });

  it("exporta mais de 500 clientes em várias páginas, sem duplicar IDs", async () => {
    const clients = Array.from({ length: 502 }, (_, index) =>
      makeExportClient(index + 1),
    );
    mockListClients
      .mockResolvedValueOnce({
        data: clients.slice(0, 500),
        total: clients.length,
        page: 1,
        limit: 500,
      })
      .mockResolvedValueOnce({
        data: [clients[499], clients[500], clients[501]],
        total: clients.length,
        page: 2,
        limit: 500,
      });

    await clickExportClients();

    expect(mockListClients).toHaveBeenCalledTimes(2);
    expect(mockListClients).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ limit: 500, page: 1 }),
    );
    expect(mockListClients).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 500, page: 2 }),
    );
    expect(mockCreateObjectURL).toHaveBeenCalledOnce();
    expect(mockAnchorClick).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith({
      title: "502 clientes exportados!",
    });

    const blob = (mockCreateObjectURL.mock.calls as unknown[][])[0][0] as Blob;
    const exportedNames = parseExportedClientNames(await readBlobAsText(blob));
    const expectedNames = clients.map((client) => client.name);

    expect(exportedNames).toHaveLength(502);
    expect(new Set(exportedNames).size).toBe(502);
    expect(exportedNames).toEqual(expectedNames);
  });

  it("não baixa CSV parcial se uma página posterior falhar", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      makeExportClient(index + 1),
    );
    mockListClients
      .mockResolvedValueOnce({
        data: firstPage,
        total: 501,
        page: 1,
        limit: 500,
      })
      .mockRejectedValueOnce(new Error("Falha simulada na segunda página"));

    await clickExportClients();

    expect(mockListClients).toHaveBeenCalledTimes(2);
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(mockAnchorClick).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Não foi possível exportar os clientes",
        variant: "destructive",
      }),
    );
  });

  it("não baixa CSV parcial quando o total recebido diverge do total inicial", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      makeExportClient(index + 1),
    );
    mockListClients
      .mockResolvedValueOnce({
        data: firstPage,
        total: 501,
        page: 1,
        limit: 500,
      })
      .mockResolvedValueOnce({
        data: [],
        total: 501,
        page: 2,
        limit: 500,
      });

    await clickExportClients();

    expect(mockListClients).toHaveBeenCalledTimes(2);
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(mockAnchorClick).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Não foi possível exportar os clientes",
        variant: "destructive",
      }),
    );
  });
});

describe("QueryErrorState", () => {
  it("executa o callback de retry do estado de erro compartilhado", async () => {
    const retry = vi.fn();
    const handle = await renderComponent(
      createElement(QueryErrorState, {
        resourceLabel: "os dados analíticos",
        error: new Error("Falha temporária"),
        onRetry: retry,
      }),
    );

    expect(handle.container.textContent).toContain("Não foi possível carregar os dados analíticos");
    expect(handle.container.textContent).toContain("Falha temporária");

    const button = handle.container.querySelector("button");
    expect(button?.textContent).toContain("Tentar novamente");
    await flushAct(() => button!.click());

    expect(retry).toHaveBeenCalledTimes(1);
  });
});