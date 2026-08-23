import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";
import { EMPTY_FORM, type TripFormData } from "../pages/trips/types.js";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, className, type, onClick }: Record<string, unknown>) =>
    createElement(
      "button",
      {
        className: (className as string) || "",
        type: (type as string) || "button",
        onClick,
      },
      children as never,
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    createElement("input", {
      type: (props.type as string) || "text",
      value: (props.value as string) ?? "",
      placeholder: (props.placeholder as string) || "",
      className: (props.className as string) || "",
      onChange: props.onChange as (event: { target: { value: string } }) => void,
    }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectTrigger: ({ children, className }: { children: unknown; className?: string }) =>
    createElement("button", { className: className || "" }, children as never),
  SelectValue: () => createElement("span"),
}));

vi.mock("lucide-react", () => ({
  AlertTriangle: () => createElement("span"),
  Clock: () => createElement("span"),
  MapPin: () => createElement("span"),
  Plus: () => createElement("span"),
  X: () => createElement("span"),
}));

import { TripFormTransportTab } from "../pages/trips/TripFormTransportTab.js";

afterEach(async () => {
  await cleanupRoots();
});

describe("TripFormTransportTab — conflito de assento", () => {
  it("destaca o assento ocupado e exibe os avisos do conflito", async () => {
    const seatConflictMessage =
      "Os assentos 12 já estão ocupados por reservas ativas. Escolha outros assentos.";
    const form: TripFormData = {
      ...EMPTY_FORM,
      freePassengers: [
        {
          id: "free-passenger-1",
          name: "Maria da Silva",
          cpf: "",
          whatsapp: "",
          role: "organizer",
          seatNumber: "12",
        },
      ],
    };

    const { container } = await renderComponent(
      createElement(TripFormTransportTab, {
        form,
        setForm: vi.fn(),
        conflictingSeats: ["12"],
        seatConflictMessage,
      }),
    );

    const seatInput = container.querySelector(
      'input[placeholder="Ex: 12"]',
    ) as HTMLInputElement | null;
    expect(seatInput).not.toBeNull();
    expect(seatInput?.className).toContain("border-destructive");

    expect(container.textContent).toContain(
      "Assento 12 já está ocupado por uma reserva ativa.",
    );

    const alertBanner = Array.from(container.querySelectorAll("div")).find(
      (element) =>
        element.className.includes("bg-destructive/10") &&
        element.textContent?.includes(seatConflictMessage),
    );
    expect(alertBanner).toBeDefined();
    expect(alertBanner?.textContent).toContain(seatConflictMessage);
  });
});