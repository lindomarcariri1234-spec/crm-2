/**
 * Regression guard — ClientModal "Novo Cliente" wizard must NOT call
 * createDeal.mutateAsync when createReservation.mutateAsync returns a
 * non-null reservation id.
 *
 * Background: Task #87 fixed a duplicate Pipeline card by adding the guard:
 *
 *   if (!createdReservationId) {
 *     await createDeal.mutateAsync(...)
 *   }
 *
 * at artifacts/visitecrm/src/pages/clients.tsx (inside handleSubmit, new-client
 * branch). When the backend's syncClientDeal already creates/moves the card via
 * the reservation, the frontend must skip its own deal creation.
 *
 * If that guard is accidentally removed, the "with trip" test will fail with:
 *   expect(createDealMock).not.toHaveBeenCalled()  ← violated
 *
 * Select component order in the rendered modal (all tabs rendered at once via
 * the mocked Tabs component):
 *   Pessoal tab:  0=origin, 1=maritalStatus, 2=gender, 3=pipelineStage
 *   Viagem tab:   4=tripId  (boardingPoint is conditional, boardingPoints=[])
 * The selectRegistry captures handlers in this DOM order on initial render.
 * Snapshot selectRegistry.handlers[4] RIGHT AFTER renderComponent, before
 * any state changes cause re-renders that append more handler entries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import type { Client } from "@workspace/api-client-react";
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Spies — hoisted so vi.mock factories can close over them
// ---------------------------------------------------------------------------
const createClientMock = vi.hoisted(() =>
  vi.fn(async (_input: { data: Record<string, unknown> }) => ({ id: "client-123", isNew: true })),
);
const updateClientMock = vi.hoisted(() =>
  vi.fn(async (_input: { id: string; data: Record<string, unknown> }) => ({ id: "client-123" })),
);
const createReservationMock = vi.hoisted(() => vi.fn());
const updateReservationMock = vi.hoisted(() => vi.fn());
const createDealMock = vi.hoisted(() => vi.fn());
const updateReservationRoomAssignmentsMock = vi.hoisted(() => vi.fn());
const calculateCommissionMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const createClientActivityMock = vi.hoisted(() => vi.fn());
const client360Fixture = vi.hoisted(() => ({
  client: null as unknown,
  reservations: [] as unknown[],
}));
const roomQueryState = vi.hoisted(() => ({
  passengersLoading: false,
  roomTwoAvailable: 2,
  existingReservation: false,
}));

// Stable data fixtures — MUST be hoisted and reused across renders.
// If useListTrips() returns a new array object on every render, then
// `selectedTrip = trips.find(...)` is a new object reference on every render,
// which re-triggers useEffect([form.tripId, selectedTrip]) → infinite loop.
const TRIPS_FIXTURE = vi.hoisted(() => ({
  data: {
    data: [
      {
        id: "trip-1",
        name: "Nordeste",
        priceAdult: 500,
        departureDate: "2026-09-01T00:00:00Z",
        destination: "Nordeste",
        boardingPoints: [] as Array<{ id: string; name: string }>,
        accommodationId: "accommodation-1",
        availableSeats: 10,
        totalCapacity: 40,
      },
    ],
  },
}));

const STAGES_FIXTURE = vi.hoisted(() => ({
  data: [{ id: "stage-lead", name: "Lead", pipelineId: "pipe-1" }],
}));

const USERS_FIXTURE = vi.hoisted(() => ({
  data: [{ id: "seller-1", name: "Vendedor de Teste" }],
}));

// selectRegistry captures onValueChange handlers from every Select instance
// in the order they are rendered to the DOM. Handlers from initial render:
//   [0] origin, [1] maritalStatus, [2] gender, [3] pipelineStage, [4] tripId
const selectRegistry = vi.hoisted(() => ({
  handlers: [] as Array<((v: string) => void) | undefined>,
  reset() {
    this.handlers = [];
  },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  // Return the SAME stable object references on every render.
  // Returning fresh objects/arrays causes selectedTrip to be a new reference
  // every render → re-triggers useEffect([form.tripId, selectedTrip]) → ∞ loop.
  useListPipelineStages: () => STAGES_FIXTURE,
  useListTrips: () => TRIPS_FIXTURE,
  useListUsers: () => USERS_FIXTURE,
  useGetMe: () => ({ data: { id: "user-1", role: "admin" } }),
  useCreateClient: () => ({ mutateAsync: createClientMock, isPending: false }),
  useUpdateClient: () => ({ mutateAsync: updateClientMock, isPending: false }),
  useCreateDeal: () => ({ mutateAsync: createDealMock, isPending: false }),
  useCreateReservation: () => ({ mutateAsync: createReservationMock, isPending: false }),
  useUpdateReservation: () => ({ mutateAsync: updateReservationMock, isPending: false }),
  useListAccommodations: () => ({ data: [] }),
  useGetTripRoomAllocationSummary: () => ({
    data: {
      accommodation: { id: "accommodation-1", name: "Pousada de Teste", type: "hotel" },
      rooms: [
        { id: "room-1", name: "Quarto 1", category: "standard", capacity: 2, available: 2, occupied: 0, status: "active", isActive: true },
        { id: "room-2", name: "Quarto 2", category: "standard", capacity: 2, available: roomQueryState.roomTwoAvailable, occupied: 0, status: "active", isActive: true },
      ],
      allocationSummary: { nights: 1, rows: [], totalRooms: 0, totalGuests: 0, totalValue: 0 },
    },
    isLoading: false,
  }),
  useListReservations: (_params: unknown, options: { query?: { queryKey?: unknown[] } } = {}) => ({
    data: {
      data: options.query?.queryKey?.[0] === "client-modal-reservations"
        ? roomQueryState.existingReservation
          ? [{ id: "reservation-existing", status: "confirmed" }]
          : []
        : client360Fixture.reservations,
    },
    isLoading: false,
  }),
  useListPassengers: () => ({
    data: roomQueryState.passengersLoading
      ? undefined
      : [{ id: "passenger-1", name: "Maria Silva" }, { id: "passenger-2", name: "A preencher" }],
    isLoading: roomQueryState.passengersLoading,
  }),
  useGetReservationRoomAssignments: () => ({
    data: {
      rooms: [],
      assignments: [{ passengerId: "passenger-1", roomId: "room-1" }],
      allocationSummary: { nights: 1, rows: [], totalRooms: 0, totalGuests: 0, totalValue: 0 },
    },
    isLoading: false,
  }),
  useUpdateReservationRoomAssignments: () => ({
    mutateAsync: updateReservationRoomAssignmentsMock,
    isPending: false,
  }),
  useCalculateCommission: (params: unknown) => {
    calculateCommissionMock(params);
    return {
      data: {
        commissionAmount: "85",
        commissionType: "percentage",
        commissionRate: "10",
      },
    };
  },
  useListPayments: () => ({ data: { data: [] }, isLoading: false }),
  useDeleteClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getListClientActivitiesQueryKey: (...args: unknown[]) => ["client-activities", ...args],
  getGetClientReferralQueryKey: (...args: unknown[]) => ["client-referral", ...args],
  getGetClientQueryKey: (...args: unknown[]) => ["client", ...args],
  getListReservationsQueryKey: (...args: unknown[]) => ["reservations", ...args],
  getListPaymentsQueryKey: (...args: unknown[]) => ["payments", ...args],
  getGetClientLoyaltyQueryKey: (...args: unknown[]) => ["client-loyalty", ...args],
  getListLoyaltyMembersQueryKey: (...args: unknown[]) => ["loyalty-members", ...args],
  getListLoyaltyTransactionsQueryKey: (...args: unknown[]) => ["loyalty-transactions", ...args],
  useGetClient: () => ({ data: client360Fixture.client, isLoading: false }),
  useGetClientLoyalty: () => ({ data: null }),
  useListLoyaltyMembers: () => ({ data: [] }),
  useListLoyaltyTransactions: () => ({ data: [] }),
  useListClientActivities: () => ({ data: { data: [] }, isLoading: false }),
  useCreateClientActivity: () => ({ mutateAsync: createClientActivityMock, isPending: false }),
  useGetClientReferral: () => ({ data: null, isLoading: false }),
  useGenerateClientReferralCode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListOutboundMessages: () => ({ data: { data: [] }, isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/SeatMapPicker", () => ({
  SeatMapPicker: () => null,
}));

vi.mock("@/hooks/use-upload", () => ({
  useUploadDocument: () => ({ uploadDocument: vi.fn(), isUploading: false }),
}));

vi.mock("@/components/plan-limit-wall", () => ({
  PlanLimitWall: () => null,
  usePlanLimitError: () => ({ isLimitError: false }),
}));

vi.mock("@/pages/reservations/financial", () => ({
  getReservationFinancialSummary: (reservation: {
    subtotal?: number;
    discount?: number;
    total?: number;
    paid?: number;
    balance?: number;
  }) => ({
    subtotal: reservation.subtotal ?? 0,
    discount: reservation.discount ?? 0,
    total: reservation.total ?? 0,
    paid: reservation.paid ?? 0,
    balance: reservation.balance ?? 0,
  }),
}));

// ---------------------------------------------------------------------------
// UI component stubs
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: unknown;
    onClick?: () => void;
    disabled?: boolean;
  }) =>
    createElement("button", { onClick, disabled: disabled ?? false }, children as never),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: unknown;
  }) => (open ? createElement("div", { "data-testid": "dialog" }, children as never) : null),
  DialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogTitle: ({ children }: { children: unknown }) =>
    createElement("h2", null, children as never),
  DialogFooter: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogDescription: ({ children }: { children: unknown }) =>
    createElement("p", null, children as never),
}));

// All tabs content is rendered unconditionally so every form field is present
// in the DOM without needing to simulate tab switching.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: unknown }) =>
    createElement("div", { "data-testid": "tabs" }, children as never),
  TabsList: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsTrigger: ({ children }: { children: unknown }) =>
    createElement("button", { type: "button" }, children as never),
  TabsContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

// Select mock: pushes each instance's onValueChange into selectRegistry
// (same pattern as PassengersListCategoryFilter.test.ts). Tests call the
// saved handler directly rather than dispatching DOM events. This is robust
// because the handler closes over stable React setState refs.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
    value,
    children,
  }: {
    onValueChange?: (v: string) => void;
    value?: string;
    children?: unknown;
  }) => {
    const index = selectRegistry.handlers.length;
    selectRegistry.handlers.push(onValueChange);
    return createElement("div", {
      "data-select-index": index,
      "data-selected-value": value,
    }, children as never);
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: unknown;
  }) => createElement("span", { "data-value": value }, children as never),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    createElement("input", props as never),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) =>
    createElement("textarea", props as never),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    id?: string;
  }) =>
    createElement("input", {
      type: "checkbox",
      checked: checked ?? false,
      id,
      onChange: () => onCheckedChange?.(!checked),
    }),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  CardContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  CardHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) =>
    createElement("span", null, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("div", { "aria-label": "loading" }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DropdownMenuContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: unknown;
    onClick?: () => void;
  }) =>
    createElement("button", { type: "button", onClick }, children as never),
  DropdownMenuSeparator: () => createElement("hr"),
  DropdownMenuLabel: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DropdownMenuTrigger: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogDescription: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogFooter: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: unknown;
    onClick?: () => void;
  }) =>
    createElement("button", { type: "button", onClick }, children as never),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: unknown;
    onClick?: () => void;
  }) =>
    createElement("button", { type: "button", onClick }, children as never),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
  useSearch: () => "",
}));

// ---------------------------------------------------------------------------
// Import the component under test — must come AFTER all vi.mock calls
// ---------------------------------------------------------------------------
import { ClientModal } from "../pages/clients.js";
import { Client360Modal } from "../components/client360-modal.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set the value of a React-controlled <input> and trigger its onChange handler
 * using the native HTMLInputElement.prototype.value setter + a bubbling change
 * event, which React 18's root-level event delegation intercepts.
 */
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A valid Brazilian CPF that passes isValidCPF(). */
const VALID_CPF_DIGITS = "11144477735"; // 111.444.777-35 after maskCPF

function clientFixture(overrides: Record<string, unknown> = {}): Client {
  return {
    id: "client-123",
    name: "Maria Silva",
    email: "maria@example.com",
    whatsapp: "+5531999999999",
    phone: "31999999999",
    cpf: VALID_CPF_DIGITS,
    rg: "MG1234567",
    birthDate: "1990-10-15T00:00:00.000Z",
    gender: "female",
    addressCity: "Recife",
    addressState: "PE",
    instagram: "@mariaSilva",
    pipelineStage: "Lead",
    classification: "lead",
    status: "active",
    origin: "Indicação",
    maritalStatus: "Casada",
    observations: "Prefere contato pela manhã.",
    tags: ["vip", "família"],
    dreamDestinations: ["Chapada Diamantina"],
    professionalArea: "Educação",
    favoriteDrink: "Café",
    musicalPreferences: "MPB",
    foodPreferences: "Vegetariana",
    internalRating: 4,
    companyFeedback: "Atendimento excelente.",
    companyNps: 9,
    travelInterests: ["Natureza"],
    ambassadorOptIn: true,
    totalSpent: 950,
    outstandingBalance: 650,
    ...overrides,
  } as unknown as Client;
}

function inputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
    .find(candidate => candidate.placeholder === placeholder);
  if (!input) throw new Error(`Expected input with placeholder: ${placeholder}`);
  return input;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectRegistry.reset();
  updateClientMock.mockReset();
  updateClientMock.mockResolvedValue({ id: "client-123" });
  client360Fixture.client = null;
  client360Fixture.reservations = [];
  // createClient always resolves with a fresh client id
  createClientMock.mockResolvedValue({ id: "client-123", isNew: true });
  updateClientMock.mockReset().mockResolvedValue({});
  // Default: reservation succeeds
  createReservationMock.mockResolvedValue({ id: "res-456" });
  updateReservationMock.mockReset().mockResolvedValue({});
  TRIPS_FIXTURE.data.data[0]!.boardingPoints = [];
  // Default: deal creation succeeds (only relevant when guard allows it through)
  createDealMock.mockResolvedValue({ id: "deal-789" });
  updateReservationRoomAssignmentsMock.mockResolvedValue({});
  roomQueryState.passengersLoading = false;
  roomQueryState.roomTwoAvailable = 2;
  roomQueryState.existingReservation = false;
  calculateCommissionMock.mockClear();
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClientModal — no-duplicate Pipeline card guard (if !createdReservationId)", () => {
  it("passes the discounted reservation amount to the commission preview", async () => {
    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    // Capture the initial handlers before state changes append handlers from
    // subsequent renders. With no boarding points, the financial selects are:
    // [8] payment method and [9] consultant/seller.
    const tripIdHandler = selectRegistry.handlers[4];
    const consultantHandler = selectRegistry.handlers[9];
    expect(tripIdHandler).toBeDefined();
    expect(consultantHandler).toBeDefined();

    const numberInputs = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const quantityInput = numberInputs().find(input => input.placeholder === "1");
    const discountInput = numberInputs().filter(input => input.placeholder === "0,00")[1];
    expect(quantityInput).toBeDefined();
    expect(discountInput).toBeDefined();

    await flushAct(() => {
      tripIdHandler?.("trip-1");
      consultantHandler?.("seller-1");
    });

    // Ticket price comes from the selected trip (R$500), then the form sets
    // quantity to 2 and applies a R$150 discount: 500 × 2 − 150 = R$850.
    await flushAct(() => {
      if (quantityInput) setNativeInputValue(quantityInput, "2");
      if (discountInput) setNativeInputValue(discountInput, "150");
    });

    const latestCall = calculateCommissionMock.mock.calls.at(-1);
    expect(latestCall?.[0]).toMatchObject({
      sellerId: "seller-1",
      saleAmount: 850,
      tripId: "trip-1",
    });
  });

  it("shows an inline WhatsApp warning without blocking save for an invalid number", async () => {
    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    const nameInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("Maria"));
    const whatsappInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("+55"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva");
      if (whatsappInput) setNativeInputValue(whatsappInput, "319999999");
    });

    expect(container.textContent).toContain("Número fora do padrão do WhatsApp brasileiro");
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Criar"),
    );
    expect(submitBtn?.disabled).toBe(false);
  });

  it("shows a CPF conflict as a readable inline warning instead of a destructive toast", async () => {
    const serverMessage = "O WhatsApp informado já está associado a um cadastro com outro CPF nesta agência. A unificação automática foi bloqueada para evitar mesclar pessoas diferentes.";
    createClientMock.mockRejectedValueOnce({
      data: { code: "CLIENT_CPF_CONFLICT", error: serverMessage },
    });

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input"));
    const nameInput = inputs.find((input) => input.placeholder?.includes("Maria"));
    const whatsappInput = inputs.find((input) => input.placeholder?.includes("+55"));
    const cpfInput = inputs.find((input) => input.placeholder?.includes("000.000.000"));
    const emailInput = inputs.find((input) => input.type === "email");
    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Criar Cliente"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva");
      if (whatsappInput) setNativeInputValue(whatsappInput, "31999999999");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
      if (emailInput) setNativeInputValue(emailInput, "maria@example.com");
    });
    expect(submitButton).toBeDefined();

    await flushAct(async () => {
      submitButton?.click();
    });

    const warning = container.querySelector('[data-testid="status-client-cpf-conflict"]');
    expect(warning?.textContent).toContain("Unificação automática bloqueada");
    expect(warning?.textContent).toContain(serverMessage);
    expect(warning?.textContent).toContain("Nenhum dado foi mesclado");
    expect(toastMock).not.toHaveBeenCalled();

    await flushAct(() => {
      if (cpfInput) setNativeInputValue(cpfInput, "52998224725");
    });
    expect(container.querySelector('[data-testid="status-client-cpf-conflict"]')).toBeNull();
  });

  /**
   * HAPPY PATH — primary regression check.
   *
   * When:  a trip is selected AND createReservation returns { id: "res-456" }
   * Then:  createdReservationId is truthy → guard fires → createDeal is skipped.
   *
   * This is the exact scenario Task #87 fixed.  If someone removes the
   * `if (!createdReservationId)` guard, this test will fail.
   */
  it("does NOT call createDeal when reservation creation succeeds (non-null id returned)", async () => {
    createReservationMock.mockResolvedValue({ id: "res-456" });

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    // Snapshot the tripId handler from the initial render.
    // Select rendering order (all tabs visible due to mocked Tabs):
    //   Pessoal:  [0] origin, [1] maritalStatus, [2] gender, [3] pipelineStage
    //   Viagem:   [4] tripId  (boardingPoint not rendered: boardingPoints=[])
    // Re-renders triggered by subsequent state changes append MORE handlers,
    // so we must capture index 4 before any state mutations.
    const tripIdHandler = selectRegistry.handlers[4];
    expect(tripIdHandler).toBeDefined();

    // Fill required text fields using the native-setter trick so React's
    // root event listener fires the controlled-input onChange handler.
    const nameInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("Maria"));

    const whatsappInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("+55"));

    const cpfInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("000.000.000"));

    const emailInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("maria@email.com"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531999999999");
      // CPF goes through maskCPF → "111.444.777-35" which passes isValidCPF
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
      if (emailInput) setNativeInputValue(emailInput, "maria@example.com");
    });

    // Select the trip — triggers tripId state update + the useEffect that
    // sets ticketPrice = String(selectedTrip.priceAdult) = "500"
    await flushAct(() => {
      tripIdHandler?.("trip-1");
    });

    // Click the submit button (enabled: name + whatsapp are set)
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Criar"),
    );
    expect(submitBtn).toBeDefined();
    expect(submitBtn?.disabled).toBe(false);

    await flushAct(async () => {
      submitBtn?.click();
    });

    // Reservation was attempted: hasTrip=true + ticketPrice=500 > 0
    expect(createReservationMock).toHaveBeenCalledOnce();

    // Guard is active: createdReservationId="res-456" → !createdReservationId=false
    // → createDeal must NOT be called (no duplicate Pipeline card)
    expect(createDealMock).not.toHaveBeenCalled();
  });

  it("sends the selected boarding-point ID when a complimentary reservation is created", async () => {
    TRIPS_FIXTURE.data.data[0]!.boardingPoints = [
      { id: "boarding-juazeiro", name: "Rodoviária de Juazeiro do Norte" },
    ];

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    const tripIdHandler = selectRegistry.handlers[4];
    const nameInput = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
      .find(input => input.placeholder?.includes("Maria"));
    const whatsappInput = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
      .find(input => input.placeholder?.includes("+55"));
    const cpfInput = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
      .find(input => input.placeholder?.includes("000.000.000"));
    const emailInput = Array.from(container.querySelectorAll<HTMLInputElement>("input"))
      .find(input => input.placeholder?.includes("maria@email.com"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531999999999");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
      if (emailInput) setNativeInputValue(emailInput, "maria@example.com");
      tripIdHandler?.("trip-1");
    });

    const boardingPointOption = container.querySelector<HTMLElement>(
      '[data-value="boarding-juazeiro"]',
    );
    const boardingSelectIndex = Number(
      boardingPointOption?.closest("[data-select-index]")?.getAttribute("data-select-index"),
    );
    const boardingPointHandler = selectRegistry.handlers[boardingSelectIndex];
    expect(boardingPointHandler).toBeDefined();
    expect(boardingPointOption).not.toBeNull();

    await flushAct(() => {
      boardingPointHandler?.("boarding-juazeiro");
      container.querySelector<HTMLInputElement>("#isGratuidade")?.click();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("Criar"));
    expect(submitButton?.disabled).toBe(false);
    await flushAct(async () => {
      submitButton?.click();
    });

    expect(createReservationMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isGratuidade: true,
        boardingLocationId: "boarding-juazeiro",
      }),
    }));
  });

  /**
   * CONTROL — no trip selected.
   *
   * When no trip is chosen, createReservation is never called, so
   * createdReservationId stays undefined, and the guard opens → createDeal IS
   * called to create a lead card in the Pipeline, even when the caller does
   * not provide a stage explicitly and the modal must use the Lead fallback.
   */
  it("DOES call createDeal when no trip is selected (normal lead-without-reservation path)", async () => {
    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        pipelineId: "pipe-1",
      }),
    );

    const nameInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("Maria"));

    const whatsappInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("+55"));

    const cpfInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("000.000.000"));

    const emailInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("maria@email.com"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "João Souza");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531888888888");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
      if (emailInput) setNativeInputValue(emailInput, "joao@example.com");
    });
    // No trip selected — tripId stays "none"

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Criar"),
    );
    expect(submitBtn).toBeDefined();
    expect(submitBtn?.disabled).toBe(false);

    await flushAct(async () => {
      submitBtn?.click();
    });

    // No trip → reservation never attempted
    expect(createReservationMock).not.toHaveBeenCalled();

    // Guard opens (createdReservationId=undefined) → deal IS created for lead
    expect(createDealMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stageId: "stage-lead",
        title: "João Souza — Lead",
      }),
    });
  });

  /**
   * FALLBACK — reservation creation throws.
   *
   * When reservation creation fails, createdReservationId stays undefined.
   * The guard must still open and create the deal so the Pipeline card appears
   * (the catch block at lines 580-582 in clients.tsx silently swallows the
   * error and continues).
   */
  it("DOES call createDeal when reservation creation throws (fallback guard path)", async () => {
    createReservationMock.mockRejectedValue(new Error("seat conflict"));

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: null,
        onSave: vi.fn(),
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    // Snapshot tripId handler before any re-renders
    const tripIdHandler = selectRegistry.handlers[4];
    expect(tripIdHandler).toBeDefined();

    const nameInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("Maria"));

    const whatsappInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("+55"));

    const cpfInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("000.000.000"));

    const emailInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("maria@email.com"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Pedro Lima");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531777777777");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
      if (emailInput) setNativeInputValue(emailInput, "pedro@example.com");
    });

    await flushAct(() => {
      tripIdHandler?.("trip-1");
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Criar"),
    );
    expect(submitBtn).toBeDefined();
    expect(submitBtn?.disabled).toBe(false);

    await flushAct(async () => {
      submitBtn?.click();
    });

    // Reservation was attempted but threw
    expect(createReservationMock).toHaveBeenCalledOnce();

    // createdReservationId stayed undefined → guard opens → deal created
    expect(createDealMock).toHaveBeenCalledOnce();
  });

  it("replaces the active reservation room assignments without creating another reservation", async () => {
    roomQueryState.existingReservation = true;
    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: {
          id: "client-123",
          name: "Maria Silva",
          totalSpent: 0,
          outstandingBalance: 0,
        } as never,
        onSave: vi.fn(),
        pipelineId: "pipe-1",
      }),
    );

    // Initial Select order: origin, marital status, gender, pipeline stage,
    // trip, travel type, accommodation, room, payment method, consultant.
    const tripIdHandler = selectRegistry.handlers[4];
    const roomIdHandler = selectRegistry.handlers[7];
    expect(tripIdHandler).toBeDefined();
    expect(roomIdHandler).toBeDefined();

    await flushAct(() => {
      tripIdHandler?.("trip-1");
    });
    await flushAct(() => {
      roomIdHandler?.("room-2");
    });

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent?.includes("Salvar Alterações") || button.textContent?.includes("Salvando"),
    );
    expect(submitButton).toBeDefined();
    expect(submitButton?.disabled).toBe(false);

    await flushAct(async () => {
      submitButton?.click();
    });

    expect(createReservationMock).not.toHaveBeenCalled();
    expect(updateReservationRoomAssignmentsMock).toHaveBeenCalledWith({
      reservationId: "reservation-existing",
      data: {
        assignments: [
          { passengerId: "passenger-1", roomId: "room-2" },
          { passengerId: "passenger-2", roomId: "room-2" },
        ],
      },
    });
  });

  it("shows the capacity warning and keeps the selected room available for retry", async () => {
    roomQueryState.existingReservation = true;
    updateReservationRoomAssignmentsMock.mockRejectedValueOnce({
      data: {
        code: "ROOM_CAPACITY_EXCEEDED",
        roomId: "room-2",
        capacity: 2,
        occupied: 3,
        currentOccupied: 2,
        requestedCount: 1,
      },
    });

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: {
          id: "client-123",
          name: "Maria Silva",
          totalSpent: 0,
          outstandingBalance: 0,
        } as never,
        onSave: vi.fn(),
        pipelineId: "pipe-1",
      }),
    );
    const tripIdHandler = selectRegistry.handlers[4];
    const roomIdHandler = selectRegistry.handlers[7];

    await flushAct(() => {
      tripIdHandler?.("trip-1");
    });
    await flushAct(() => {
      roomIdHandler?.("room-2");
    });

    const submitButton = () =>
      Array.from(container.querySelectorAll("button")).find(
        button => button.textContent?.includes("Salvar Alterações"),
      );
    expect(submitButton()).toBeDefined();

    await flushAct(async () => {
      submitButton()?.click();
    });

    const expectedDescription =
      "Os dados do cliente foram salvos, mas quarto 2 sem vagas: Capacidade: 2 pessoa(s). Ocupação atual: 2. Vagas disponíveis antes desta tentativa: 0. Escolha outro quarto e tente novamente.";
    expect(toastMock).toHaveBeenCalledWith({
      title: "Quarto 2 sem vagas",
      description: expectedDescription,
      variant: "destructive",
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(expectedDescription);
    expect(submitButton()).toBeDefined();
    expect(createReservationMock).not.toHaveBeenCalled();

    // The selected room remains in form state, so a retry sends the same room.
    await flushAct(async () => {
      submitButton()?.click();
    });
    expect(updateReservationRoomAssignmentsMock).toHaveBeenCalledTimes(2);
    expect(updateReservationRoomAssignmentsMock.mock.calls[1][0]).toEqual({
      reservationId: "reservation-existing",
      data: {
        assignments: [
          { passengerId: "passenger-1", roomId: "room-2" },
          { passengerId: "passenger-2", roomId: "room-2" },
        ],
      },
    });
  });

  it("keeps edited client data and the previous room assignment when availability changes before save", async () => {
    roomQueryState.existingReservation = true;
    let persistedRoomId: string | null = "room-1";
    updateReservationRoomAssignmentsMock.mockImplementationOnce(
      async ({ data }: { data: { assignments: Array<{ roomId: string | null }> } }) => {
        if (roomQueryState.roomTwoAvailable === 0) {
          throw {
            data: {
              code: "ROOM_CAPACITY_EXCEEDED",
              roomId: "room-2",
              capacity: 2,
              occupied: 3,
              currentOccupied: 2,
              requestedCount: 1,
            },
          };
        }
        persistedRoomId = data.assignments[0]?.roomId ?? null;
        return { assignments: data.assignments };
      },
    );

    const modalProps = {
      open: true,
      onClose: vi.fn(),
      editClient: {
        id: "client-123",
        name: "Maria Silva",
        totalSpent: 0,
        outstandingBalance: 0,
      } as never,
      onSave: vi.fn(),
      pipelineId: "pipe-1",
    };
    const { container, rerender } = await renderComponent(
      createElement(ClientModal, modalProps),
    );
    const tripIdHandler = selectRegistry.handlers[4];
    const roomIdHandler = selectRegistry.handlers[7];
    const nameInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("Maria"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva Atualizada");
      tripIdHandler?.("trip-1");
    });
    await flushAct(() => {
      roomIdHandler?.("room-2");
    });

    // A background refresh observes that the selected room became full before
    // the user submits. The selection stays in the form so the server remains
    // the authority for the final capacity check.
    roomQueryState.roomTwoAvailable = 0;
    await rerender(createElement(ClientModal, modalProps));
    expect(container.textContent).toContain("Quarto 2 · capacidade 2 · 0 vaga(s)");

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent?.includes("Salvar Alterações"),
    );
    expect(submitButton).toBeDefined();

    await flushAct(async () => {
      submitButton?.click();
    });

    expect(updateClientMock).toHaveBeenCalledWith({
      id: "client-123",
      data: expect.objectContaining({ name: "Maria Silva Atualizada" }),
    });
    expect(updateReservationRoomAssignmentsMock).toHaveBeenCalledWith({
      reservationId: "reservation-existing",
      data: {
        assignments: [
          { passengerId: "passenger-1", roomId: "room-2" },
          { passengerId: "passenger-2", roomId: "room-2" },
        ],
      },
    });
    expect(persistedRoomId).toBe("room-1");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Os dados do cliente foram salvos, mas quarto 2 sem vagas",
    );
  });

  it("keeps editing disabled until the existing reservation passengers finish loading", async () => {
    roomQueryState.existingReservation = true;
    roomQueryState.passengersLoading = true;

    const { container } = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose: vi.fn(),
        editClient: {
          id: "client-123",
          name: "Maria Silva",
          totalSpent: 0,
          outstandingBalance: 0,
        } as never,
        onSave: vi.fn(),
        pipelineId: "pipe-1",
      }),
    );
    const tripIdHandler = selectRegistry.handlers[4];
    expect(tripIdHandler).toBeDefined();

    await flushAct(() => {
      tripIdHandler?.("trip-1");
    });

    const submitButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent?.includes("Salvar Alterações") || button.textContent?.includes("Salvando"),
    );
    expect(submitButton?.disabled).toBe(true);

    await flushAct(async () => {
      submitButton?.click();
    });

    expect(updateReservationRoomAssignmentsMock).not.toHaveBeenCalled();
    expect(createReservationMock).not.toHaveBeenCalled();
  });
});

describe("client record persistence", () => {
  it("saves representative client and reservation data, then reloads it in both client views", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const modal = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose,
        editClient: null,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    const tripHandler = selectRegistry.handlers[4];
    const travelTypeHandler = selectRegistry.handlers[5];
    const roomTypeHandler = selectRegistry.handlers[6];
    const paymentMethodHandler = selectRegistry.handlers[8];
    const consultantHandler = selectRegistry.handlers[9];
    expect(tripHandler).toBeDefined();
    expect(paymentMethodHandler).toBeDefined();
    expect(consultantHandler).toBeDefined();

    await flushAct(() => {
      setNativeInputValue(inputByPlaceholder(modal.container, "Maria Silva"), "Ana Costa");
      setNativeInputValue(inputByPlaceholder(modal.container, "+55 31 99999-9999"), "+5531999999999");
      setNativeInputValue(inputByPlaceholder(modal.container, "000.000.000-00"), VALID_CPF_DIGITS);
      setNativeInputValue(inputByPlaceholder(modal.container, "maria@email.com"), "ana@example.com");
      setNativeInputValue(inputByPlaceholder(modal.container, "@mariaSilva"), "@anaCosta");
      setNativeInputValue(inputByPlaceholder(modal.container, "Belo Horizonte"), "Recife");

      const birthDate = modal.container.querySelector<HTMLInputElement>('input[type="date"]');
      if (!birthDate) throw new Error("Expected a birth-date input");
      setNativeInputValue(birthDate, "1992-04-16");
    });

    await flushAct(() => {
      setNativeInputValue(inputByPlaceholder(modal.container, "Ex: Saúde, Tecnologia..."), "Tecnologia");
      setNativeInputValue(inputByPlaceholder(modal.container, "Ex: Vinho, Cerveja artesanal..."), "Café");
      setNativeInputValue(inputByPlaceholder(modal.container, "Ex: Sertanejo, Rock, MPB..."), "MPB");
      setNativeInputValue(inputByPlaceholder(modal.container, "Ex: Frutos do mar, Vegetariano..."), "Vegetariana");
      setNativeInputValue(
        inputByPlaceholder(modal.container, "Arraial do Cabo, Morro de São Paulo, Fernando de Noronha"),
        "Chapada Diamantina, Lençóis Maranhenses",
      );
      setNativeInputValue(inputByPlaceholder(modal.container, "vip, família, aventura, praia"), "vip, família");
    });

    const interestButtons = Array.from(modal.container.querySelectorAll("button"));
    for (const interest of ["Natureza", "Cultura e história"]) {
      const button = interestButtons.find(candidate => candidate.textContent?.trim() === interest);
      expect(button, `travel interest button ${interest}`).toBeDefined();
      await flushAct(() => button?.click());
    }

    await flushAct(() => {
      tripHandler?.("trip-1");
      travelTypeHandler?.("Excursão");
      roomTypeHandler?.("Quarto Casal");
      paymentMethodHandler?.("PIX");
      consultantHandler?.("seller-1");
    });

    const numberInputs = () =>
      Array.from(modal.container.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const currencyInputs = numberInputs().filter(input => input.placeholder === "0,00");
    const quantityInput = numberInputs().find(input => input.placeholder === "1");
    const installmentsInput = numberInputs().find(input => input.max === "12");
    expect(currencyInputs).toHaveLength(4);
    expect(quantityInput).toBeDefined();
    expect(installmentsInput).toBeDefined();

    await flushAct(() => {
      setNativeInputValue(currencyInputs[1]!, "50");
      setNativeInputValue(currencyInputs[2]!, "300");
      setNativeInputValue(currencyInputs[3]!, "40");
      if (quantityInput) setNativeInputValue(quantityInput, "2");
      if (installmentsInput) setNativeInputValue(installmentsInput, "3");
    });

    const submitButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("Criar Cliente"));
    expect(submitButton).toBeDefined();
    await flushAct(async () => submitButton?.click());

    expect(createClientMock).toHaveBeenCalledOnce();
    const createdData = createClientMock.mock.calls[0]?.[0].data;
    expect(createdData).toMatchObject({
      name: "Ana Costa",
      email: "ana@example.com",
      whatsapp: "+5531999999999",
      cpf: VALID_CPF_DIGITS,
      instagram: "@anaCosta",
      addressCity: "Recife",
      professionalArea: "Tecnologia",
      favoriteDrink: "Café",
      musicalPreferences: "MPB",
      foodPreferences: "Vegetariana",
      dreamDestinations: ["Chapada Diamantina", "Lençóis Maranhenses"],
      tags: ["vip", "família"],
      travelInterests: ["Natureza", "Cultura e história"],
    });
    expect(createdData?.birthDate).toEqual(expect.stringContaining("1992-04-16"));

    expect(createReservationMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: "trip-1",
        clientId: "client-123",
        totalValue: 950,
        paidValue: 300,
        discountTotal: 50,
        paymentMethod: "pix",
        installments: 3,
        commissionAmount: 40,
        sellerId: "seller-1",
      }),
    });
    expect(onSave).toHaveBeenCalledWith(false, "client-123");
    expect(onClose).toHaveBeenCalledOnce();

    const savedClient = clientFixture({
      ...createdData,
      id: "client-123",
      totalSpent: 950,
      outstandingBalance: 650,
    });
    await modal.rerender(
      createElement(ClientModal, {
        open: false,
        onClose,
        editClient: savedClient,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );
    await modal.rerender(
      createElement(ClientModal, {
        open: true,
        onClose,
        editClient: savedClient,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    expect(inputByPlaceholder(modal.container, "Maria Silva").value).toBe("Ana Costa");
    expect(inputByPlaceholder(modal.container, "maria@email.com").value).toBe("ana@example.com");
    expect(inputByPlaceholder(modal.container, "Belo Horizonte").value).toBe("Recife");
    expect(inputByPlaceholder(modal.container, "vip, família, aventura, praia").value).toBe("vip, família");
    const reopenedNatureButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.trim() === "Natureza");
    expect(reopenedNatureButton?.className).toContain("bg-primary");

    client360Fixture.client = savedClient;
    client360Fixture.reservations = [{
      id: "res-456",
      status: "confirmed",
      client: savedClient,
      trip: { id: "trip-1", name: "Circuito da Chapada", departureDate: "2026-11-01T12:00:00.000Z" },
      seats: ["12"],
      subtotal: 1000,
      discount: 50,
      total: 950,
      paid: 300,
      balance: 650,
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }));

    const details = await renderComponent(
      createElement(Client360Modal, {
        open: true,
        onClose: vi.fn(),
        clientId: "client-123",
      }),
    );
    const detailText = details.container.textContent ?? "";
    expect(detailText).toContain("Ana Costa");
    expect(detailText).toContain("ana@example.com");
    expect(detailText).toContain("Chapada Diamantina");
    expect(detailText).toContain("Natureza");
    expect(detailText).toContain("Circuito da Chapada");
    expect(detailText).toContain("950,00");
    expect(detailText).toContain("300,00");
    expect(detailText).toContain("650,00");
  });

  it("preserves edited personal and preference values when the client form is reopened", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const originalClient = clientFixture();
    const modal = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose,
        editClient: originalClient,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );
    const tripHandler = selectRegistry.handlers[4];
    const paymentMethodHandler = selectRegistry.handlers[8];
    const consultantHandler = selectRegistry.handlers[9];

    await flushAct(() => {
      setNativeInputValue(inputByPlaceholder(modal.container, "Maria Silva"), "Maria Nogueira");
      setNativeInputValue(inputByPlaceholder(modal.container, "Ex: Saúde, Tecnologia..."), "Tecnologia");
      setNativeInputValue(
        inputByPlaceholder(modal.container, "Arraial do Cabo, Morro de São Paulo, Fernando de Noronha"),
        "Chapada Diamantina, Lençóis Maranhenses",
      );
      setNativeInputValue(inputByPlaceholder(modal.container, "vip, família, aventura, praia"), "premium, aventura");
    });

    const adventureButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.trim() === "Aventura");
    expect(adventureButton).toBeDefined();
    await flushAct(() => adventureButton?.click());

    await flushAct(() => {
      tripHandler?.("trip-1");
      paymentMethodHandler?.("PIX");
      consultantHandler?.("seller-1");
    });
    const financialInputs = Array.from(
      modal.container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ).filter(input => input.placeholder === "0,00");
    const installmentsInput = Array.from(
      modal.container.querySelectorAll<HTMLInputElement>('input[type="number"]'),
    ).find(input => input.max === "12");
    expect(financialInputs).toHaveLength(4);
    expect(installmentsInput).toBeDefined();
    await flushAct(() => {
      setNativeInputValue(financialInputs[1]!, "50");
      setNativeInputValue(financialInputs[2]!, "200");
      setNativeInputValue(financialInputs[3]!, "15");
      if (installmentsInput) setNativeInputValue(installmentsInput, "2");
    });

    const saveButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("Salvar Alterações"));
    expect(saveButton).toBeDefined();
    await flushAct(async () => saveButton?.click());

    expect(updateClientMock).toHaveBeenCalledOnce();
    const update = updateClientMock.mock.calls[0]?.[0];
    expect(update?.id).toBe("client-123");
    expect(update?.data).toMatchObject({
      name: "Maria Nogueira",
      professionalArea: "Tecnologia",
      dreamDestinations: ["Chapada Diamantina", "Lençóis Maranhenses"],
      tags: ["premium", "aventura"],
      travelInterests: ["Natureza", "Aventura"],
    });
    expect(createReservationMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: "trip-1",
        clientId: "client-123",
        totalValue: 450,
        paidValue: 200,
        discountTotal: 50,
        paymentMethod: "pix",
        installments: 2,
        commissionAmount: 15,
        sellerId: "seller-1",
      }),
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    const savedClient = clientFixture({ ...originalClient, ...update?.data });
    await modal.rerender(
      createElement(ClientModal, {
        open: false,
        onClose,
        editClient: originalClient,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );
    await modal.rerender(
      createElement(ClientModal, {
        open: true,
        onClose,
        editClient: savedClient,
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );

    expect(inputByPlaceholder(modal.container, "Maria Silva").value).toBe("Maria Nogueira");
    expect(inputByPlaceholder(modal.container, "Ex: Saúde, Tecnologia...").value).toBe("Tecnologia");
    expect(
      inputByPlaceholder(
        modal.container,
        "Arraial do Cabo, Morro de São Paulo, Fernando de Noronha",
      ).value,
    ).toBe("Chapada Diamantina, Lençóis Maranhenses");
    expect(inputByPlaceholder(modal.container, "vip, família, aventura, praia").value).toBe("premium, aventura");
    const reopenedAdventureButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.trim() === "Aventura");
    expect(reopenedAdventureButton?.className).toContain("bg-primary");
  });

  it("shows a destructive save error and keeps the edit form open when updating fails", async () => {
    updateClientMock.mockRejectedValue(new Error("Falha ao salvar o cadastro"));
    const onClose = vi.fn();
    const onSave = vi.fn();
    const modal = await renderComponent(
      createElement(ClientModal, {
        open: true,
        onClose,
        editClient: clientFixture(),
        onSave,
        defaultStageId: "stage-lead",
        pipelineId: "pipe-1",
      }),
    );
    await flushAct(() => {
      setNativeInputValue(inputByPlaceholder(modal.container, "Maria Silva"), "Maria Alterada");
    });

    const saveButton = Array.from(modal.container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("Salvar Alterações"));
    expect(saveButton).toBeDefined();
    await flushAct(async () => saveButton?.click());

    expect(updateClientMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledOnce();
    expect(toastMock.mock.calls[0]?.[0]).toMatchObject({ variant: "destructive" });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(modal.container.querySelector('[data-testid="dialog"]')).not.toBeNull();
  });
});
