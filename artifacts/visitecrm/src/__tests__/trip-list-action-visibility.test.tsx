import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { Trip } from "@workspace/api-client-react";
import { ROLES } from "@workspace/permissions";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mocks = vi.hoisted(() => ({
  useTrips: vi.fn(),
  useGetTenant: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  getStoreSettings: vi.fn(),
  getStoreProducts: vi.fn(),
  createStoreProduct: vi.fn(),
  updateStoreProduct: vi.fn(),
  buildTripCsvHeader: vi.fn(() => "Nome"),
  buildTripCsvRows: vi.fn(() => "Viagem de teste"),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/trips", mocks.navigate],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTenant: mocks.useGetTenant,
}));

vi.mock("@/hooks/useTrips", () => ({
  useTrips: mocks.useTrips,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    getSettings: mocks.getStoreSettings,
    getProducts: mocks.getStoreProducts,
    createProduct: mocks.createStoreProduct,
    updateProduct: mocks.updateStoreProduct,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: unknown;
    onClick?: () => void;
    [key: string]: unknown;
  }) => createElement("button", { onClick, ...props }, children as never),
}));

vi.mock("@/components/ui/input", () => ({
  Input: () => createElement("input"),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) =>
    createElement("span", null, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectTrigger: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: unknown }) =>
    open ? createElement("div", null, children as never) : null,
  DialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("../pages/trips/TripCountdown.js", () => ({
  TripCountdown: () => null,
  OccupancyBar: () => null,
}));

vi.mock("../pages/trips/BoardingPanelModal.js", () => ({
  BoardingPanelModal: () => null,
}));

vi.mock("../pages/trips/TripCsvImportModal.js", () => ({
  TripCsvImportModal: () => null,
}));

vi.mock("../pages/trips/constants.js", () => ({
  STATUS_MAP: {
    upcoming: { label: "Próxima", color: "bg-blue-100 text-blue-800" },
  },
  TRIP_TYPES: [],
  TRIP_TYPE_LABELS: {},
}));

vi.mock("../pages/trips/utils.js", () => ({
  formatCurrency: (value: number) => `R$ ${value}`,
  formatTripDateRange: () => "01 a 03 de novembro",
  generateProductSlug: () => "viagem-de-teste",
  buildTripProductPayload: () => ({}),
}));

vi.mock("@/lib/trip-csv-import", () => ({
  buildTripCsvHeader: mocks.buildTripCsvHeader,
  buildTripCsvRows: mocks.buildTripCsvRows,
}));

import { TripList } from "../pages/trips/TripList.js";

const trip: Trip = {
  id: "trip-1",
  name: "Viagem de teste",
  slug: "viagem-de-teste",
  destination: "Cariri",
  destinationCity: "Juazeiro do Norte",
  destinationState: "CE",
  originCity: "Fortaleza",
  originState: "CE",
  type: "excursion",
  category: "tour",
  departureDate: "2026-11-01",
  returnDate: "2026-11-03",
  departureTime: "08:00",
  returnTime: "18:00",
  totalCapacity: 40,
  availableSeats: 20,
  reservedSeats: 15,
  confirmedSeats: 5,
  priceAdult: 300,
  priceChild: 200,
  priceSenior: 250,
  inclusions: [],
  exclusions: [],
  coverImage: null,
  gallery: [],
  status: "upcoming",
  isPublic: false,
  isFeatured: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type ActionVisibility = {
  create: boolean;
  edit: boolean;
  duplicate: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
  publish: boolean;
  media: boolean;
};

const allActions: ActionVisibility = {
  create: true,
  edit: true,
  duplicate: true,
  delete: true,
  import: true,
  export: true,
  publish: true,
  media: true,
};

const managerActions: ActionVisibility = {
  create: true,
  edit: true,
  duplicate: true,
  delete: false,
  import: false,
  export: true,
  publish: false,
  media: true,
};

const readOnlyActions: ActionVisibility = {
  create: false,
  edit: false,
  duplicate: false,
  delete: false,
  import: false,
  export: false,
  publish: false,
  media: false,
};

const roleScenarios: Array<{
  label: string;
  role: string;
  expected: ActionVisibility;
}> = [
  { label: "superadministrador", role: ROLES.SUPER_ADMIN, expected: allActions },
  { label: "administrador da agência", role: ROLES.AGENCY_ADMIN, expected: allActions },
  { label: "gerente da agência", role: ROLES.AGENCY_MANAGER, expected: managerActions },
  { label: "vendas", role: ROLES.SALES, expected: readOnlyActions },
  { label: "suporte", role: ROLES.SUPPORT, expected: readOnlyActions },
];

function makeTripsHook(role: string) {
  return {
    trips: [trip],
    exportTrips: vi.fn().mockResolvedValue(1),
    isLoading: false,
    isError: false,
    error: null,
    totalPages: 1,
    upcomingTrips: [],
    stats: { total: 1, active: 1, occupancyRate: 50, totalRevenue: 0 },
    me: { tenantId: "tenant-1", role },
    search: "",
    setSearch: vi.fn(),
    statusFilter: "all",
    setStatusFilter: vi.fn(),
    typeFilter: "all",
    setTypeFilter: vi.fn(),
    dateFilter: "",
    setDateFilter: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    deleteTrip: { mutateAsync: vi.fn(), isPending: false },
    handleDuplicate: vi.fn(),
    handleDelete: vi.fn(),
    hasActiveFilters: false,
    clearFilters: vi.fn(),
    refetch: vi.fn(),
  };
}

function getVisibleActions(container: HTMLElement): ActionVisibility {
  const buttons = [...container.querySelectorAll("button")];
  const hasButtonText = (text: string) =>
    buttons.some((button) => button.textContent?.includes(text));

  return {
    create: Boolean(container.querySelector('a[href="/trips/new"]')),
    edit: Boolean(container.querySelector('a[href="/trips/trip-1/edit"]')),
    duplicate: Boolean(container.querySelector('button[title="Duplicar"]')),
    delete: Boolean(container.querySelector('button[title="Excluir"]')),
    import: hasButtonText("Importar planilha"),
    export: hasButtonText("Exportar CSV"),
    publish: Boolean(container.querySelector('button[title="Publicar na Loja"]')),
    media: Boolean(container.querySelector('a[href="/trips/media"]')),
  };
}

beforeEach(() => {
  mocks.useGetTenant.mockReturnValue({ data: { settings: { seatMapEnabled: true } } });
  mocks.useTrips.mockReset();
  mocks.toast.mockReset();
  mocks.navigate.mockReset();
  mocks.getStoreSettings.mockResolvedValue({});
  mocks.getStoreProducts.mockResolvedValue([]);
  mocks.createStoreProduct.mockReset();
  mocks.updateStoreProduct.mockReset();
  mocks.buildTripCsvHeader.mockReturnValue("Nome");
  mocks.buildTripCsvRows.mockReturnValue("Viagem de teste");
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("TripList — visibilidade das ações por perfil", () => {
  for (const scenario of roleScenarios) {
    it(`exibe somente as ações permitidas para ${scenario.label} nos modos de grade e lista`, async () => {
      mocks.useTrips.mockReturnValue(makeTripsHook(scenario.role));
      const handle = await renderComponent(createElement(TripList));

      expect(getVisibleActions(handle.container)).toEqual(scenario.expected);

      const listToggle = handle.container.querySelector<HTMLButtonElement>(
        '[data-testid="view-list"]',
      );
      if (!listToggle) throw new Error("O botão do modo de lista não foi renderizado");

      await flushAct(() => listToggle.click());
      expect(getVisibleActions(handle.container)).toEqual(scenario.expected);
    });
  }
});