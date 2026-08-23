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

  it("destaca assentos duplicados entre passageiros gratuitos", async () => {
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
        {
          id: "free-passenger-2",
          name: "João da Silva",
          cpf: "",
          whatsapp: "",
          role: "guide",
          seatNumber: " 12 ",
        },
      ],
    };

    const { container } = await renderComponent(
      createElement(TripFormTransportTab, {
        form,
        setForm: vi.fn(),
      }),
    );

    const seatInputs = Array.from(container.querySelectorAll(
      'input[placeholder="Ex: 12"]',
    )) as HTMLInputElement[];
    expect(seatInputs).toHaveLength(2);
    expect(seatInputs.every(input => input.className.includes("border-destructive"))).toBe(true);
    expect(container.textContent).toContain(
      "Assento 12 já está atribuído a outro passageiro gratuito.",
    );
    expect(container.textContent).toContain(
      "Assento  12  já está atribuído a outro passageiro gratuito.",
    );
  });

  it("remove o destaque, o aviso do campo e o banner após corrigir o assento", async () => {
    const seatConflictMessage =
      "Os assentos 12 já estão ocupados por reservas ativas. Escolha outros assentos.";
    const conflictingForm: TripFormData = {
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
    const { container, rerender } = await renderComponent(
      createElement(TripFormTransportTab, {
        form: conflictingForm,
        setForm: vi.fn(),
        conflictingSeats: ["12"],
        seatConflictMessage,
      }),
    );

    const availableForm: TripFormData = {
      ...conflictingForm,
      freePassengers: [{ ...conflictingForm.freePassengers[0], seatNumber: "13" }],
    };
    await rerender(
      createElement(TripFormTransportTab, {
        form: availableForm,
        setForm: vi.fn(),
        conflictingSeats: [],
        seatConflictMessage: null,
      }),
    );

    const seatInput = container.querySelector(
      'input[placeholder="Ex: 12"]',
    ) as HTMLInputElement | null;
    expect(seatInput).not.toBeNull();
    expect(seatInput?.value).toBe("13");
    expect(seatInput?.className).not.toContain("border-destructive");
    expect(container.textContent).not.toContain(
      "Assento 13 já está ocupado por uma reserva ativa.",
    );
    expect(container.textContent).not.toContain(seatConflictMessage);
    expect(
      Array.from(container.querySelectorAll("div")).find(
        (element) =>
          element.className.includes("bg-destructive/10") &&
          element.textContent?.includes(seatConflictMessage),
      ),
    ).toBeUndefined();
  });
});
