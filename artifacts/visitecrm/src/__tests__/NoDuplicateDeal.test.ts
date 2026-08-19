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
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Spies — hoisted so vi.mock factories can close over them
// ---------------------------------------------------------------------------
const createClientMock = vi.hoisted(() => vi.fn());
const createReservationMock = vi.hoisted(() => vi.fn());
const createDealMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

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
        availableSeats: 10,
        totalCapacity: 40,
      },
    ],
  },
}));

const STAGES_FIXTURE = vi.hoisted(() => ({
  data: [{ id: "stage-lead", name: "Lead", pipelineId: "pipe-1" }],
}));

const USERS_FIXTURE = vi.hoisted(() => ({ data: [] as unknown[] }));

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
  useUpdateClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateDeal: () => ({ mutateAsync: createDealMock, isPending: false }),
  useCreateReservation: () => ({ mutateAsync: createReservationMock, isPending: false }),
  useCalculateCommission: () => ({ data: null }),
  useListPayments: () => ({ data: { data: [] }, isLoading: false }),
  useDeleteClient: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/SeatMapPicker", () => ({
  SeatMapPicker: () => null,
}));

vi.mock("@/components/plan-limit-wall", () => ({
  PlanLimitWall: () => null,
  usePlanLimitError: () => ({ isLimitError: false }),
}));

vi.mock("@/components/client360-modal", () => ({
  Client360Modal: () => null,
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
    children,
  }: {
    onValueChange?: (v: string) => void;
    children?: unknown;
  }) => {
    selectRegistry.handlers.push(onValueChange);
    return createElement("div", null, children as never);
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  selectRegistry.reset();
  // createClient always resolves with a fresh client id
  createClientMock.mockResolvedValue({ id: "client-123", isNew: true });
  // Default: reservation succeeds
  createReservationMock.mockResolvedValue({ id: "res-456" });
  // Default: deal creation succeeds (only relevant when guard allows it through)
  createDealMock.mockResolvedValue({ id: "deal-789" });
});

afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClientModal — no-duplicate Pipeline card guard (if !createdReservationId)", () => {
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

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Maria Silva");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531999999999");
      // CPF goes through maskCPF → "111.444.777-35" which passes isValidCPF
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
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

  /**
   * CONTROL — no trip selected.
   *
   * When no trip is chosen, createReservation is never called, so
   * createdReservationId stays undefined, and the guard opens → createDeal IS
   * called to create a lead card in the Pipeline.
   */
  it("DOES call createDeal when no trip is selected (normal lead-without-reservation path)", async () => {
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

    const cpfInput = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).find((el) => el.placeholder?.includes("000.000.000"));

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "João Souza");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531888888888");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
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
    expect(createDealMock).toHaveBeenCalledOnce();
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

    await flushAct(() => {
      if (nameInput) setNativeInputValue(nameInput, "Pedro Lima");
      if (whatsappInput) setNativeInputValue(whatsappInput, "+5531777777777");
      if (cpfInput) setNativeInputValue(cpfInput, VALID_CPF_DIGITS);
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
});
