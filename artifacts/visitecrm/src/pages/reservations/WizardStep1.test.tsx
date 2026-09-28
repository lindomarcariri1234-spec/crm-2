import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanupRoots, flushAct, renderComponent } from "../../__tests__/eventSourceHarness.js";

const passthrough = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: {
    children?: ReactNode;
    onClick?: ComponentProps<"button">["onClick"];
  }) => createElement("button", { onClick }, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => createElement("input", props),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => createElement("hr"),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: passthrough,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => createElement(
    "div",
    { "data-select-value": value },
    children,
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "choose-trip-point",
        onClick: () => onValueChange?.("trip-point-1"),
      },
      "Selecionar ponto",
    ),
  ),
  SelectContent: passthrough,
  SelectItem: ({ children, value }: { children?: ReactNode; value?: string }) =>
    createElement("div", { "data-select-item-value": value }, children),
  SelectTrigger: passthrough,
  SelectValue: passthrough,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: passthrough,
  PopoverContent: passthrough,
  PopoverTrigger: passthrough,
}));

vi.mock("@/components/ui/command", () => ({
  Command: passthrough,
  CommandEmpty: passthrough,
  CommandGroup: passthrough,
  CommandInput: passthrough,
  CommandItem: passthrough,
  CommandList: passthrough,
}));

vi.mock("@/components/SeatMapPicker", () => ({
  SeatMapPicker: () => null,
}));

vi.mock("lucide-react", () => ({
  Check: () => createElement("span"),
  ChevronsUpDown: () => createElement("span"),
  Plus: () => createElement("span"),
  Loader2: () => createElement("span"),
}));

afterEach(async () => {
  await cleanupRoots();
});

it("shows trip point time and address while keeping agency catalog choices", async () => {
  const onSelectBoarding = vi.fn();
  const { WizardStep1 } = await import("./WizardStep1.js");
  const { container } = await renderComponent(createElement(WizardStep1, {
    allTrips: [],
    allClients: [],
    boardingOptions: [
      {
        id: "trip-point-1",
        name: "Asa de Crato",
        time: "21:00",
        address: "Praça Siqueira Campos",
      },
      {
        id: "catalog-point-1",
        name: "Terminal Rodoviário",
        address: "Rua do Comércio",
      },
    ],
    selectedTripFull: undefined,
    selectedTripId: "",
    selectedClientId: "",
    boardingLocationId: "trip-point-1",
    selectedSeats: [],
    manualSeats: "",
    tripComboOpen: false,
    clientComboOpen: false,
    canGoNext: false,
    clientSearch: "",
    isCpfMode: false,
    nameSearchResults: [],
    nameSearchLoading: false,
    cpfMatches: [],
    cpfSearchLoading: false,
    pendingClient: null,
    setTripComboOpen: vi.fn(),
    setClientComboOpen: vi.fn(),
    onSelectTrip: vi.fn(),
    onSelectClient: vi.fn(),
    onClientSearchChange: vi.fn(),
    onCreateNewClient: vi.fn(),
    onCloseClientCombo: vi.fn(),
    onSelectBoarding,
    onSelectSeats: vi.fn(),
    onManualSeatsChange: vi.fn(),
    onClose: vi.fn(),
    onNext: vi.fn(),
  }));

  expect(container.textContent).toContain("Ponto de embarque");
  expect(container.querySelector('[data-select-value="trip-point-1"]')).not.toBeNull();
  expect(container.querySelector('[data-select-item-value="trip-point-1"]')?.textContent)
    .toContain("Asa de Crato");
  expect(container.querySelector('[data-select-item-value="trip-point-1"]')?.textContent)
    .toContain("Horário: 21:00");
  expect(container.querySelector('[data-select-item-value="trip-point-1"]')?.textContent)
    .toContain("Endereço: Praça Siqueira Campos");
  expect(container.querySelector('[data-select-item-value="catalog-point-1"]')?.textContent)
    .toContain("Terminal Rodoviário");

  const choosePoint = container.querySelector('[data-testid="choose-trip-point"]') as HTMLButtonElement | null;
  expect(choosePoint).not.toBeNull();
  await flushAct(() => choosePoint?.click());
  expect(onSelectBoarding).toHaveBeenCalledWith("trip-point-1");
});