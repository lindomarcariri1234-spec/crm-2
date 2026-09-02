import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockUseListClients = vi.hoisted(() => vi.fn());
const mockUseListDestinations = vi.hoisted(() => vi.fn());
const mockRefetchClients = vi.hoisted(() => vi.fn());
const mockRefetchDestinations = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

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
  useListClients: mockUseListClients,
  useListDestinations: mockUseListDestinations,
  useListPipelineStages: vi.fn(() => ({ data: [] })),
  useListTrips: vi.fn(() => ({ data: { data: [] } })),
  useListUsers: vi.fn(() => ({ data: [] })),
  useGetMe: vi.fn(() => ({ data: null })),
  useCreateClient: vi.fn(() => mockMutation),
  useUpdateClient: vi.fn(() => mockMutation),
  useCreateDeal: vi.fn(() => mockMutation),
  useCreateReservation: vi.fn(() => mockMutation),
  useCalculateCommission: vi.fn(() => ({ data: undefined })),
  useDeleteClient: vi.fn(() => mockMutation),
  useCreateDestination: vi.fn(() => mockMutation),
  useUpdateDestination: vi.fn(() => mockMutation),
  useDeleteDestination: vi.fn(() => mockMutation),
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
  vi.clearAllMocks();
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