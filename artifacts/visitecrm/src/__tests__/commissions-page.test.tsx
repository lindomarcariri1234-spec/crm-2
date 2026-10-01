import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { ACTIONS, RESOURCES } from "@workspace/permissions";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mocks = vi.hoisted(() => ({
  useListCommissions: vi.fn(),
  useListCommissionRules: vi.fn(),
  useUpdateCommission: vi.fn(),
  useCreateCommissionRule: vi.fn(),
  useUpdateCommissionRule: vi.fn(),
  useDeleteCommissionRule: vi.fn(),
  useListTrips: vi.fn(),
  useListReservations: vi.fn(),
  useRetryCommissionSync: vi.fn(),
  can: vi.fn((_resource: string, _action: string) => true),
  isGerente: false as boolean,
  search: "",
  navigate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListCommissions: mocks.useListCommissions,
  useListCommissionRules: mocks.useListCommissionRules,
  useUpdateCommission: mocks.useUpdateCommission,
  useCreateCommissionRule: mocks.useCreateCommissionRule,
  useUpdateCommissionRule: mocks.useUpdateCommissionRule,
  useDeleteCommissionRule: mocks.useDeleteCommissionRule,
  useListTrips: mocks.useListTrips,
  useListReservations: mocks.useListReservations,
  useRetryCommissionSync: mocks.useRetryCommissionSync,
}));

vi.mock("wouter", () => ({
  useSearch: () => mocks.search,
  useLocation: () => ["/comissoes", mocks.navigate],
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isGerente: mocks.isGerente }),
}));

import Commissions from "../pages/commissions.js";

const trip = { id: "trip-1", name: "Rota Cariri de Novembro" };
const fixedTripRule = {
  id: "rule-fixed-trip",
  name: "Comissão fixa da Rota Cariri",
  type: "fixed",
  value: "125.50",
  appliesTo: "trip",
  tripId: trip.id,
  isActive: false,
};

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

function setSuccessfulQueries() {
  const mutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
  mocks.useListCommissions.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  mocks.useListCommissionRules.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  mocks.useListTrips.mockReturnValue({ data: { data: [] } });
  mocks.useListReservations.mockReturnValue({ data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() });
  mocks.useUpdateCommission.mockReturnValue(mutation);
  mocks.useCreateCommissionRule.mockReturnValue(mutation);
  mocks.useUpdateCommissionRule.mockReturnValue(mutation);
  mocks.useDeleteCommissionRule.mockReturnValue(mutation);
  mocks.useRetryCommissionSync.mockReturnValue(mutation);
}

function setReadOnlyManager() {
  mocks.isGerente = true;
  mocks.can.mockImplementation(
    (resource, action) => resource === RESOURCES.COMMISSIONS && action === ACTIONS.VIEW,
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.search = "";
  mocks.isGerente = false;
  mocks.can.mockReturnValue(true);
  setSuccessfulQueries();
});

afterEach(async () => {
  await cleanupRoots();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    delete (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
  }
  vi.clearAllMocks();
});

describe("commission rules", () => {
  it("keeps a fixed trip-specific inactive rule unchanged when it is edited and saved", async () => {
    mocks.search = "?tab=rules";
    mocks.useListCommissionRules.mockReturnValue({
      data: [fixedTripRule],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useListTrips.mockReturnValue({ data: { data: [trip] } });
    const updateRuleMutation = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
    mocks.useUpdateCommissionRule.mockReturnValue(updateRuleMutation);

    const handle = await renderComponent(createElement(Commissions));
    const ruleRow = [...handle.container.querySelectorAll("tr")]
      .find(row => row.textContent?.includes(fixedTripRule.name));
    if (!ruleRow) throw new Error("The fixed commission rule row was not rendered");

    expect(ruleRow.textContent).toContain("Inativa");
    expect(ruleRow.textContent).toContain(trip.name);

    const editButton = ruleRow.querySelector("button");
    if (!editButton) throw new Error("The commission rule edit button was not rendered");
    await flushAct(() => editButton.click());

    const form = document.body.querySelector("form");
    if (!form) throw new Error("The commission rule edit form was not opened");
    const selectors = [...form.querySelectorAll('[role="combobox"]')];
    expect(selectors[0]?.textContent).toContain("Valor Fixo (R$)");
    expect(selectors[1]?.textContent).toContain("Uma viagem específica");
    expect(selectors[2]?.textContent).toContain(trip.name);
    expect((form.querySelector('input[name="name"]') as HTMLInputElement).value).toBe(fixedTripRule.name);
    expect((form.querySelector('input[name="value"]') as HTMLInputElement).value).toBe(fixedTripRule.value);
    expect((form.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);

    const saveButton = [...form.querySelectorAll("button")]
      .find(button => button.textContent?.includes("Salvar Regra"));
    if (!saveButton) throw new Error("The save rule button was not rendered");
    await flushAct(() => saveButton.click());

    expect(updateRuleMutation.mutateAsync).toHaveBeenCalledWith({
      id: fixedTripRule.id,
      data: {
        name: fixedTripRule.name,
        type: "fixed",
        value: fixedTripRule.value,
        appliesTo: "trip",
        tripId: trip.id,
        isActive: false,
      },
    });
  });

  it("hides approve and retry actions from a read-only manager", async () => {
    mocks.search = "?tab=commissions";
    setReadOnlyManager();
    mocks.useListCommissions.mockReturnValue({
      data: [{
        id: "commission-pending",
        userId: "seller-123456789",
        reservationId: "reservation-1",
        baseAmount: "500.00",
        commissionAmount: "50.00",
        status: "pending",
        paidAt: null,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useListReservations.mockReturnValue({
      data: { data: [{
        id: "reservation-failed",
        reservationNumber: "RSV-42",
        client: { name: "Cliente de teste" },
        trip: { name: trip.name },
        totalValue: 500,
      }] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const handle = await renderComponent(createElement(Commissions));
    expect(handle.container.textContent).toContain("Acesso somente para consulta");

    const commissionsButtons = [...handle.container.querySelectorAll("button")]
      .map(button => button.textContent?.trim());
    expect(commissionsButtons).not.toContain("Aprovar");
    expect(commissionsButtons).not.toContain("Retentar");
  });

  it("hides create, edit, and delete actions from a read-only manager on the rules tab", async () => {
    mocks.search = "?tab=rules";
    setReadOnlyManager();
    mocks.useListCommissionRules.mockReturnValue({
      data: [fixedTripRule],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mocks.useListTrips.mockReturnValue({ data: { data: [trip] } });

    const handle = await renderComponent(createElement(Commissions));
    expect(handle.container.textContent).not.toContain("Nova Regra");
    expect(handle.container.textContent).not.toContain("Ações");
    const ruleRow = [...handle.container.querySelectorAll("tr")]
      .find(row => row.textContent?.includes(fixedTripRule.name));
    if (!ruleRow) throw new Error("The read-only commission rule row was not rendered");
    expect(ruleRow.querySelectorAll("button")).toHaveLength(0);
  });
});