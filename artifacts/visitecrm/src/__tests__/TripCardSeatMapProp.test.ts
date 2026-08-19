import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["/trips", vi.fn()],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    listTripProducts: vi.fn(),
    createTripProduct: vi.fn(),
    updateTripProduct: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...rest }: { children: unknown; onClick?: () => void; [k: string]: unknown }) =>
    createElement("button", { onClick, ...rest }, children as never),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) =>
    createElement("span", { "data-testid": "badge" }, children as never),
}));

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

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("../pages/trips/TripCountdown.js", () => ({
  TripCountdown: () => null,
  OccupancyBar: () => null,
}));

vi.mock("../pages/trips/utils.js", () => ({
  formatCurrency: (v: number) => `R$ ${v}`,
  formatDate: (d: string) => d,
  generateProductSlug: () => "slug",
  buildTripProductPayload: () => ({}),
}));

vi.mock("../pages/trips/constants.js", () => ({
  STATUS_MAP: {} as Record<string, { label: string; color: string }>,
}));

import { TripCard } from "../pages/trips/TripCard.js";

// ---------------------------------------------------------------------------
// Minimal Trip fixture
// ---------------------------------------------------------------------------
import type { Trip } from "@workspace/api-client-react";

function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    name: "Viagem Teste",
    destination: "São Paulo",
    destinationCity: "São Paulo",
    destinationState: "SP",
    originCity: null,
    originState: null,
    departureDate: "2026-08-01",
    departureTime: null,
    returnDate: null,
    returnTime: null,
    status: "upcoming",
    totalCapacity: 40,
    availableSeats: 20,
    reservedSeats: 15,
    confirmedSeats: 5,
    priceAdult: 300,
    coverImage: null,
    tenantId: "tenant-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Trip;
}

function renderCard(seatMapEnabled?: boolean) {
  return renderComponent(
    createElement(TripCard, {
      trip: makeTrip(),
      isVendedor: false,
      ...(seatMapEnabled !== undefined ? { seatMapEnabled } : {}),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onBoarding: vi.fn(),
    }),
  );
}

// ---------------------------------------------------------------------------
afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
describe("TripCard — seatMapEnabled prop gates the Mapa button", () => {
  it("hides the seat-map link when seatMapEnabled is false", async () => {
    const { container } = await renderCard(false);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).toBeNull();
  });

  it("shows the seat-map link when seatMapEnabled is true", async () => {
    const { container } = await renderCard(true);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });

  it("shows the seat-map link when seatMapEnabled is omitted (default = true)", async () => {
    const { container } = await renderCard(undefined);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });
});
