import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const { mockToast, mockTenantId } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockTenantId: { value: "club-benefit-test-tenant" },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetMe: () => ({ data: { tenantId: mockTenantId.value } }),
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{ value: string; onValueChange: (value: string) => void }>({
    value: "bronze",
    onValueChange: () => {},
  });

  return {
    Tabs: ({ value, onValueChange, children }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => React.createElement(
      TabsContext.Provider,
      { value: { value, onValueChange } },
      children,
    ),
    TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement("div", props, children),
    TabsTrigger: ({ value, children, ...props }: {
      value: string;
      children: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const tabs = React.useContext(TabsContext);
      return React.createElement(
        "button",
        {
          ...props,
          type: "button",
          role: "tab",
          "aria-selected": tabs.value === value,
          "data-state": tabs.value === value ? "active" : "inactive",
          onClick: () => tabs.onValueChange(value),
        },
        children,
      );
    },
    TabsContent: ({ value, children, ...props }: {
      value: string;
      children: React.ReactNode;
    } & React.HTMLAttributes<HTMLDivElement>) => {
      const tabs = React.useContext(TabsContext);
      return tabs.value === value
        ? React.createElement("div", { ...props, role: "tabpanel" }, children)
        : null;
    },
  };
});

import { ClubConfigTab } from "../pages/configuracoes.js";

const tiers = ["bronze", "silver", "gold", "diamond"] as const;
const benefitDraftStorageKey = "visitecrm:club-benefit-draft:v1:club-benefit-test-tenant";
const otherTenantBenefitDraftStorageKey = "visitecrm:club-benefit-draft:v1:club-benefit-other-tenant";

function makeResponse(ok: boolean, body: unknown = {}, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

function getTab(container: HTMLElement, tier: string): HTMLButtonElement {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="club-tier-tab-${tier}"]`);
  if (!tab) throw new Error(`Missing tab for ${tier}`);
  return tab;
}

function expectTierCount(container: HTMLElement, tier: string, count: number): void {
  expect(container.querySelector(`[data-testid="club-tier-count-${tier}"]`)?.textContent)
    .toBe(String(count));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

let fetchMock: ReturnType<typeof vi.fn>;
let rejectPost = false;
let deferPost = false;
let completePost: (() => void) | null = null;
let rejectPut = false;
let conflictPut = false;
let conflictBenefit: Record<string, unknown> | null = null;
let conflictBenefitQueue: Array<Record<string, unknown>> = [];
let rejectDelete = false;
let deferDelete = false;
let completeDelete: (() => void) | null = null;
let completeDeletes = new Map<string, (ok?: boolean) => void>();
let benefitsForLoad: Array<{
  id: string;
  tier: string;
  benefitKey: string;
  label: string;
  description: string | null;
  value: string | null;
  sortOrder: number;
}> = [];

beforeEach(() => {
  mockToast.mockReset();
  mockTenantId.value = "club-benefit-test-tenant";
  sessionStorage.removeItem(benefitDraftStorageKey);
  sessionStorage.removeItem(otherTenantBenefitDraftStorageKey);
  rejectPost = false;
  deferPost = false;
  completePost = null;
  rejectPut = false;
  conflictPut = false;
  conflictBenefit = null;
  conflictBenefitQueue = [];
  rejectDelete = false;
  deferDelete = false;
  completeDelete = null;
  completeDeletes = new Map();
  benefitsForLoad = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/club/config")) {
      return makeResponse(true, { clubName: "Clube de teste", description: null });
    }
    if (url.endsWith("/api/club/benefits") && method === "GET") {
      return makeResponse(true, { data: benefitsForLoad.map((benefit) => ({
        ...benefit,
        updatedAt: benefit.updatedAt ?? "2026-01-01T00:00:00.000Z",
      })) });
    }
    if (url.endsWith("/api/club/benefits") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { tier: string };
      if (deferPost) {
        return new Promise((resolve) => {
          completePost = () => resolve(makeResponse(true, {
            id: "created-after-pending",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }));
        });
      }
      if (rejectPost) return makeResponse(false, { error: "creation_failed" });
      return makeResponse(true, {
        id: `benefit-${body.tier}`,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    if (url.includes("/api/club/benefits/") && method === "PUT") {
      if (conflictBenefitQueue.length > 0) {
        return makeResponse(false, {
          error: "benefit_changed",
          current: conflictBenefitQueue.shift(),
        }, 409);
      }
      if (conflictPut) {
        conflictPut = false;
        return makeResponse(false, { error: "benefit_changed", current: conflictBenefit }, 409);
      }
      return rejectPut
        ? makeResponse(false)
        : (() => {
          const body = JSON.parse(String(init?.body));
          const id = url.slice(url.lastIndexOf("/") + 1);
          const current = benefitsForLoad.find((benefit) => benefit.id === id);
          return makeResponse(true, {
            ...current,
            ...body,
            id,
            updatedAt: "2026-03-01T00:00:00.000Z",
          });
        })();
    }
    if (url.includes("/api/club/benefits/") && method === "DELETE") {
      if (deferDelete) {
        return new Promise((resolve) => {
          const id = url.slice(url.lastIndexOf("/") + 1);
          const complete = (ok = true) => resolve(makeResponse(ok));
          completeDeletes.set(id, complete);
          completeDelete = () => complete();
        });
      }
      return makeResponse(!rejectDelete);
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await cleanupRoots();
  sessionStorage.removeItem(benefitDraftStorageKey);
  sessionStorage.removeItem(otherTenantBenefitDraftStorageKey);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClubConfigTab benefit tiers", () => {
  it("keeps a failed edit available for retry while showing the last saved values", async () => {
    benefitsForLoad = [
      {
        id: "gold-benefit-editable",
        tier: "gold",
        benefitKey: "original_key",
        label: "Benefício original",
        description: "Descrição original",
        value: "10%",
        sortOrder: 0,
      },
      {
        id: "gold-benefit-failure",
        tier: "gold",
        benefitKey: "failure_key",
        label: "Benefício não alterado",
        description: "Descrição preservada",
        value: "5%",
        sortOrder: 1,
      },
    ];
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-editable"]',
      )!.click();
    });
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-editable"]',
    );
    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-value-gold-benefit-editable"]',
    );
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-editable"]',
    );
    expect(labelInput?.value).toBe("Benefício original");
    expect(valueInput?.value).toBe("10%");
    expect(descriptionInput?.value).toBe("Descrição original");

    await act(async () => {
      setInputValue(labelInput!, "Benefício atualizado");
      setInputValue(valueInput!, "15%");
      setInputValue(descriptionInput!, "Nova descrição");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-editable"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const successfulUpdate = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(successfulUpdate?.[0]).toContain("/api/club/benefits/gold-benefit-editable");
    expect(JSON.parse(String(successfulUpdate?.[1]?.body))).toEqual({
      label: "Benefício atualizado",
      value: "15%",
      description: "Nova descrição",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-editable"]')?.textContent)
      .toContain("Benefício atualizado");
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-editable"]')?.textContent)
      .toContain("Nova descrição");
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-editable"]')?.textContent)
      .toContain("15%");
    expect(container.querySelector('[data-testid="club-edit-benefit-label-gold-benefit-editable"]'))
      .toBeNull();

    rejectPut = true;
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-failure"]',
      )!.click();
    });
    const failedLabelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-failure"]',
    );
    const failedValueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-value-gold-benefit-failure"]',
    );
    const failedDescriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-failure"]',
    );
    await act(async () => {
      setInputValue(failedLabelInput!, "Alteração que falhou");
      setInputValue(failedValueInput!, "12%");
      setInputValue(failedDescriptionInput!, "Descrição da tentativa");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-failure"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-failure"]')?.textContent)
      .toContain("Benefício não alterado");
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-failure"]')?.textContent)
      .toContain("Descrição preservada");
    expect(container.querySelector('[data-testid="club-benefit-last-saved-gold-benefit-failure"]')?.textContent)
      .toContain("Benefício não alterado");
    expect(container.querySelector('[data-testid="club-benefit-last-saved-gold-benefit-failure"]')?.textContent)
      .toContain("5%");
    expect(container.querySelector('[data-testid="club-benefit-last-saved-gold-benefit-failure"]')?.textContent)
      .toContain("Descrição preservada");
    expect(failedLabelInput?.value).toBe("Alteração que falhou");
    expect(failedValueInput?.value).toBe("12%");
    expect(failedDescriptionInput?.value).toBe("Descrição da tentativa");
    expect(container.querySelector('[data-testid="club-edit-benefit-error-gold-benefit-failure"]')?.textContent)
      .toContain("Seu rascunho foi mantido");
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Erro ao atualizar benefício",
      variant: "destructive",
    }));

    rejectPut = false;
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-failure"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const retriedUpdate = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").at(-1);
    expect(JSON.parse(String(retriedUpdate?.[1]?.body))).toEqual({
      label: "Alteração que falhou",
      value: "12%",
      description: "Descrição da tentativa",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="club-edit-benefit-label-gold-benefit-failure"]'))
      .toBeNull();
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-failure"]')?.textContent)
      .toContain("Alteração que falhou");
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-failure"]')?.textContent)
      .toContain("Descrição da tentativa");
  });

  it("combines selected fields from both versions before retrying a concurrent edit", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-conflict",
      tier: "gold",
      benefitKey: "conflict_key",
      label: "Versão carregada",
      description: "Descrição carregada",
      value: "5%",
      sortOrder: 0,
    }];
    const latestBenefit = {
      ...benefitsForLoad[0],
      label: "Versão de outra pessoa",
      description: "Descrição mais recente",
      value: "8%",
      updatedAt: "2026-02-01T00:00:00.000Z",
    };
    conflictBenefit = latestBenefit;
    conflictPut = true;
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-conflict"]',
      )!.click();
    });
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-conflict"]',
    )!;
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-conflict"]',
    )!;
    await act(async () => {
      setInputValue(labelInput, "Meu rascunho");
      setInputValue(descriptionInput, "Minha descrição em rascunho");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-edit-benefit-conflict-gold-benefit-conflict"]')?.textContent)
      .toContain("Outra pessoa salvou uma versão mais recente");
    expect(container.querySelector('[data-testid="club-benefit-last-saved-gold-benefit-conflict"]')?.textContent)
      .toContain("Versão de outra pessoa");
    const conflictDetails = container.querySelector(
      '[data-testid="club-edit-benefit-conflict-gold-benefit-conflict"]',
    );
    for (const field of ["label", "value", "description"]) {
      expect(conflictDetails?.querySelector(
        `[data-testid="club-benefit-conflict-field-${field}-gold-benefit-conflict"]`,
      )).not.toBeNull();
    }
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-label-gold-benefit-conflict"]',
    )?.textContent).toContain("Antes: Versão carregada");
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-label-gold-benefit-conflict"]',
    )?.textContent).toContain("Salvo agora: Versão de outra pessoa");
    expect(labelInput.value).toBe("Meu rascunho");
    expect(labelInput.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-benefit-conflict-choice-latest-label-gold-benefit-conflict"]',
      )!.click();
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-benefit-conflict-choice-draft-label-gold-benefit-conflict"]',
      )!.click();
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-benefit-conflict-choice-latest-value-gold-benefit-conflict"]',
      )!.click();
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-benefit-conflict-choice-draft-description-gold-benefit-conflict"]',
      )!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-refresh-edit-benefit-gold-benefit-conflict"]',
      )!.click();
    });
    expect(labelInput.value).toBe("Meu rascunho");
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-value-gold-benefit-conflict"]',
    )?.value).toBe("8%");
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-conflict"]',
    )?.value).toBe("Minha descrição em rascunho");
    expect(labelInput.disabled).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(puts[1]?.[1]?.body))).toMatchObject({
      label: "Meu rascunho",
      value: "8%",
      description: "Minha descrição em rascunho",
      expectedUpdatedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("shows only the remotely changed field and can discard the draft for the current version", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-one-field-conflict",
      tier: "gold",
      benefitKey: "single_field",
      label: "Nome anterior",
      description: "Descrição igual",
      value: "5%",
      sortOrder: 0,
    }];
    conflictBenefit = {
      ...benefitsForLoad[0],
      label: "Nome atualizado por outra pessoa",
      updatedAt: "2026-02-02T00:00:00.000Z",
    };
    conflictPut = true;
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-one-field-conflict"]',
      )!.click();
    });
    await act(async () => {
      setInputValue(container.querySelector<HTMLInputElement>(
        '[data-testid="club-edit-benefit-label-gold-benefit-one-field-conflict"]',
      )!, "Meu nome em rascunho");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-one-field-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const conflictDetails = container.querySelector(
      '[data-testid="club-edit-benefit-conflict-gold-benefit-one-field-conflict"]',
    );
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-label-gold-benefit-one-field-conflict"]',
    )?.textContent).toContain("Nome atualizado por outra pessoa");
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-value-gold-benefit-one-field-conflict"]',
    )).toBeNull();
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-description-gold-benefit-one-field-conflict"]',
    )).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-discard-edit-benefit-gold-benefit-one-field-conflict"]',
      )!.click();
    });
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-one-field-conflict"]',
    )?.value).toBe("Nome atualizado por outra pessoa");
    expect(container.querySelector('[data-testid="club-edit-benefit-conflict-gold-benefit-one-field-conflict"]'))
      .toBeNull();
  });

  it("compares a second conflict with the refreshed baseline and keeps retry blocked", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-repeat-conflict",
      tier: "gold",
      benefitKey: "repeat_conflict",
      label: "Nome inicial",
      description: "Descrição inicial",
      value: "5%",
      sortOrder: 0,
    }];
    const secondVersion = {
      ...benefitsForLoad[0],
      label: "Nome salvo na versão 2",
      description: "Descrição salva na versão 2",
      updatedAt: "2026-02-04T00:00:00.000Z",
    };
    const thirdVersion = {
      ...secondVersion,
      description: "Descrição salva na versão 3",
      updatedAt: "2026-02-05T00:00:00.000Z",
    };
    conflictBenefitQueue = [secondVersion, thirdVersion];
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
    });
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-repeat-conflict"]',
    )!;
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-repeat-conflict"]',
    )!;
    await act(async () => {
      setInputValue(labelInput, "Meu rascunho");
      setInputValue(descriptionInput, "Minha descrição");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-refresh-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
    });
    expect(labelInput.value).toBe("Meu rascunho");
    expect(descriptionInput.value).toBe("Minha descrição");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const conflictDetails = container.querySelector(
      '[data-testid="club-edit-benefit-conflict-gold-benefit-repeat-conflict"]',
    );
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-label-gold-benefit-repeat-conflict"]',
    )).toBeNull();
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-description-gold-benefit-repeat-conflict"]',
    )?.textContent).toContain("Antes: Descrição salva na versão 2");
    expect(conflictDetails?.querySelector(
      '[data-testid="club-benefit-conflict-field-description-gold-benefit-repeat-conflict"]',
    )?.textContent).toContain("Salvo agora: Descrição salva na versão 3");
    expect(labelInput.value).toBe("Meu rascunho");
    expect(labelInput.disabled).toBe(true);

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-save-edit-benefit-gold-benefit-repeat-conflict"]',
    )!;
    expect(saveButton.disabled).toBe(true);
    const putCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(putCalls()).toHaveLength(2);
    await act(async () => {
      saveButton.click();
    });
    expect(putCalls()).toHaveLength(2);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-refresh-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-repeat-conflict"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(putCalls()).toHaveLength(3);
    expect(JSON.parse(String(putCalls()[1]?.[1]?.body))).toMatchObject({
      label: "Meu rascunho",
      expectedUpdatedAt: "2026-02-04T00:00:00.000Z",
    });
    expect(JSON.parse(String(putCalls()[2]?.[1]?.body))).toMatchObject({
      label: "Meu rascunho",
      expectedUpdatedAt: "2026-02-05T00:00:00.000Z",
    });
  });

  it("keeps draft fields that were not changed remotely when choosing the saved value for another field", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-mixed-merge",
      tier: "gold",
      benefitKey: "mixed_merge",
      label: "Nome anterior",
      description: "Descrição anterior",
      value: "5%",
      sortOrder: 0,
    }];
    conflictBenefit = {
      ...benefitsForLoad[0],
      label: "Nome salvo por outra pessoa",
      updatedAt: "2026-02-03T00:00:00.000Z",
    };
    conflictPut = true;
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-mixed-merge"]',
      )!.click();
    });
    await act(async () => {
      setInputValue(container.querySelector<HTMLInputElement>(
        '[data-testid="club-edit-benefit-label-gold-benefit-mixed-merge"]',
      )!, "Meu nome");
      setInputValue(container.querySelector<HTMLInputElement>(
        '[data-testid="club-edit-benefit-value-gold-benefit-mixed-merge"]',
      )!, "6%");
      setInputValue(container.querySelector<HTMLInputElement>(
        '[data-testid="club-edit-benefit-description-gold-benefit-mixed-merge"]',
      )!, "Minha descrição");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-mixed-merge"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-benefit-conflict-choice-latest-label-gold-benefit-mixed-merge"]',
      )!.click();
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-refresh-edit-benefit-gold-benefit-mixed-merge"]',
      )!.click();
    });
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-mixed-merge"]',
    )?.value).toBe("Nome salvo por outra pessoa");
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-value-gold-benefit-mixed-merge"]',
    )?.value).toBe("6%");
    expect(container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-description-gold-benefit-mixed-merge"]',
    )?.value).toBe("Minha descrição");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-mixed-merge"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const retry = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").at(-1);
    expect(JSON.parse(String(retry?.[1]?.body))).toMatchObject({
      label: "Nome salvo por outra pessoa",
      value: "6%",
      description: "Minha descrição",
      expectedUpdatedAt: "2026-02-03T00:00:00.000Z",
    });
  });

  it("lets staff cancel a failed edit and return to the unchanged saved benefit", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-cancel",
      tier: "gold",
      benefitKey: "saved_key",
      label: "Benefício salvo",
      description: "Descrição salva",
      value: "8%",
      sortOrder: 0,
    }];
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      getTab(container, "gold").click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-edit-benefit-gold-benefit-cancel"]',
      )!.click();
    });
    rejectPut = true;

    const label = container.querySelector<HTMLInputElement>(
      '[data-testid="club-edit-benefit-label-gold-benefit-cancel"]',
    );
    await act(async () => {
      setInputValue(label!, "Rascunho não salvo");
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-save-edit-benefit-gold-benefit-cancel"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="club-edit-benefit-error-gold-benefit-cancel"]'))
      .not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="club-cancel-edit-benefit-gold-benefit-cancel"]',
      )!.click();
    });

    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-cancel"]')?.textContent)
      .toContain("Benefício salvo");
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-cancel"]')?.textContent)
      .toContain("Descrição salva");
    expect(container.querySelector('[data-testid="club-edit-benefit-label-gold-benefit-cancel"]'))
      .toBeNull();
  });

  it("keeps each tier's list and count isolated while adding and removing benefits", async () => {
    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    for (const tier of tiers) {
      expectTierCount(container, tier, 0);
    }
    expect(container.querySelector('[data-testid="club-empty-tier-bronze"]')).not.toBeNull();

    for (const [index, tier] of tiers.entries()) {
      await act(async () => {
        getTab(container, tier).click();
      });

      expect(container.querySelector(`[data-testid="club-empty-tier-${tier}"]`)).not.toBeNull();
      const input = container.querySelector<HTMLInputElement>('[data-testid="club-benefit-label-input"]');
      const addButton = container.querySelector<HTMLButtonElement>('[data-testid="club-add-benefit"]');
      expect(input).not.toBeNull();
      expect(addButton).not.toBeNull();

      await act(async () => {
        setInputValue(input!, `Vantagem ${index + 1}`);
      });
      await act(async () => {
        addButton!.click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)?.textContent)
        .toContain(`Vantagem ${index + 1}`);
      expectTierCount(container, tier, 1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/club/benefits"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`"tier":"${tier}"`),
        }),
      );
    }

    for (const tier of tiers) {
      await act(async () => {
        getTab(container, tier).click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)).not.toBeNull();
      expectTierCount(container, tier, 1);
      for (const otherTier of tiers.filter((candidate) => candidate !== tier)) {
        expect(container.querySelector(`[data-testid="club-benefit-benefit-${otherTier}"]`)).toBeNull();
      }
    }

    for (const tier of tiers) {
      await act(async () => {
        getTab(container, tier).click();
      });
      const removeButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="club-delete-benefit-benefit-${tier}"]`,
      );
      expect(removeButton).not.toBeNull();

      await act(async () => {
        removeButton!.click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)).toBeNull();
      expectTierCount(container, tier, 0);
      expect(container.querySelector(`[data-testid="club-empty-tier-${tier}"]`)).not.toBeNull();
    }

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(4);
  });

  it("reuses the attempt key and avoids duplicates after a saved response is lost", async () => {
    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput).not.toBeNull();
    expect(valueInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    expect(addButton).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Desconto de boas-vindas");
      setInputValue(valueInput!, "10%");
      setInputValue(descriptionInput!, "Válido na primeira viagem");
    });

    rejectPost = true;
    await act(async () => {
      addButton!.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/club/benefits"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"tier":"bronze"'),
      }),
    );
    const failedPost = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(failedPost?.[1]?.body))).toMatchObject({
      tier: "bronze",
      label: "Desconto de boas-vindas",
      value: "10%",
      description: "Válido na primeira viagem",
    });
    expect(labelInput!.value).toBe("Desconto de boas-vindas");
    expect(valueInput!.value).toBe("10%");
    expect(descriptionInput!.value).toBe("Válido na primeira viagem");
    expect(container.querySelector('[data-testid="club-benefit-benefit-bronze"]')).toBeNull();
    expectTierCount(container, "bronze", 0);
    expect(container.querySelector('[data-testid="club-empty-tier-bronze"]')).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro ao adicionar benefício",
        variant: "destructive",
      }),
    );

    benefitsForLoad = [{
      id: "benefit-bronze",
      tier: "bronze",
      benefitKey: "desconto_de_boas-vindas",
      label: "Desconto de boas-vindas",
      description: "Válido na primeira viagem",
      value: "10%",
      sortOrder: 0,
    }];
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expectTierCount(container, "bronze", 1);

    rejectPost = false;
    await act(async () => {
      addButton!.click();
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    const retryPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")[1];
    expect(JSON.parse(String(retryPost?.[1]?.body))).toMatchObject({
      tier: "bronze",
      label: "Desconto de boas-vindas",
      value: "10%",
      description: "Válido na primeira viagem",
    });
    expect(retryPost?.[1]?.headers).toMatchObject({
      "Idempotency-Key": (failedPost?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"],
    });
    expect((failedPost?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"])
      .toMatch(/^[0-9a-f-]{36}$/i);
    expect(container.querySelector('[data-testid="club-benefit-benefit-bronze"]')?.textContent)
      .toContain("Desconto de boas-vindas");
    expectTierCount(container, "bronze", 1);
    expect(container.querySelector('[data-testid="club-empty-tier-bronze"]')).toBeNull();
  });

  it("keeps creation and retries working when session storage reads and writes throw", async () => {
    rejectPost = true;
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')?.textContent)
      .toContain("pode ser perdido");
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput?.disabled).toBe(false);
    expect(addButton?.disabled).toBe(true);
    expect(labelInput).not.toBeNull();
    expect(addButton).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Vantagem sem armazenamento");
    });
    expect(addButton!.disabled).toBe(false);
    await act(async () => {
      addButton!.click();
    });

    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1);
    const firstKey = (posts()[0]?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"];
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(setItem).toHaveBeenCalled();
    expect(getItem).toHaveBeenCalled();
    expect(labelInput!.value).toBe("Vantagem sem armazenamento");

    rejectPost = false;
    await act(async () => {
      addButton!.click();
    });
    expect(posts()).toHaveLength(2);
    expect((posts()[1]?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"])
      .toBe(firstKey);
    expect(container.querySelector('[data-testid="club-benefit-benefit-bronze"]')?.textContent)
      .toContain("Vantagem sem armazenamento");

    getItem.mockRestore();
    setItem.mockRestore();
    await act(async () => {
      setInputValue(labelInput!, "Rascunho recuperável");
    });
    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')).toBeNull();
    expect(sessionStorage.getItem(benefitDraftStorageKey)).not.toBeNull();
  });

  it("shows and clears the warning when draft writes alone fail and recover", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')).toBeNull();
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    expect(labelInput?.disabled).toBe(false);
    await act(async () => {
      setInputValue(labelInput!, "Rascunho temporário");
    });

    expect(setItem).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')?.textContent)
      .toContain("pode ser perdido");
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    )?.disabled).toBe(false);

    setItem.mockRestore();
    await act(async () => {
      setInputValue(labelInput!, "Rascunho recuperável");
    });
    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')).toBeNull();
    expect(sessionStorage.getItem(benefitDraftStorageKey)).not.toBeNull();
  });

  it("discards malformed saved data without breaking the benefit form", async () => {
    sessionStorage.setItem(benefitDraftStorageKey, "{invalid-json");
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sessionStorage.getItem(benefitDraftStorageKey)).toBeNull();
    expect(container.querySelector('[data-testid="club-benefit-storage-warning"]')).toBeNull();
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput?.disabled).toBe(false);
    expect(addButton?.disabled).toBe(true);

    await act(async () => {
      setInputValue(labelInput!, "Rascunho válido");
      addButton!.click();
    });

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    expect(post?.[1]?.headers).toMatchObject({
      "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(container.querySelector('[data-testid="club-benefit-benefit-bronze"]')?.textContent)
      .toContain("Rascunho válido");
  });

  it("restores an uncertain attempt after remount and clears its recovery data on success", async () => {
    rejectPost = true;
    const firstMount = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getTab(firstMount.container, "gold").click();
    });

    const firstLabelInput = firstMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const firstValueInput = firstMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const firstDescriptionInput = firstMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    const firstAddButton = firstMount.container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(firstLabelInput).not.toBeNull();
    expect(firstValueInput).not.toBeNull();
    expect(firstDescriptionInput).not.toBeNull();
    expect(firstAddButton).not.toBeNull();

    await act(async () => {
      setInputValue(firstLabelInput!, "Acesso ao lounge");
      setInputValue(firstValueInput!, "1 acesso");
      setInputValue(firstDescriptionInput!, "Apresente o voucher");
      firstAddButton!.click();
    });

    const savedRecovery = JSON.parse(sessionStorage.getItem(benefitDraftStorageKey) ?? "null");
    expect(savedRecovery.draft).toEqual({
      label: "Acesso ao lounge",
      value: "1 acesso",
      description: "Apresente o voucher",
    });
    expect(savedRecovery.tier).toBe("gold");
    const idempotencyKey = savedRecovery.attempt.idempotencyKey as string;

    benefitsForLoad = [{
      id: "benefit-gold",
      tier: "gold",
      benefitKey: "acesso_ao_lounge",
      label: "Acesso ao lounge",
      description: "Apresente o voucher",
      value: "1 acesso",
      sortOrder: 0,
    }];
    await cleanupRoots();
    rejectPost = false;
    const restoredMount = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labelInput = restoredMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const valueInput = restoredMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const descriptionInput = restoredMount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    const addButton = restoredMount.container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput?.value).toBe("Acesso ao lounge");
    expect(valueInput?.value).toBe("1 acesso");
    expect(descriptionInput?.value).toBe("Apresente o voucher");
    expect(getTab(restoredMount.container, "gold").getAttribute("aria-selected")).toBe("true");
    expect(restoredMount.container.querySelector('[role="status"]')?.textContent)
      .toContain("Rascunho recuperado");

    await act(async () => {
      addButton!.click();
    });

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.[1]?.headers).toMatchObject({ "Idempotency-Key": idempotencyKey });
    expect(JSON.parse(String(posts[1]?.[1]?.body))).toMatchObject({ tier: "gold" });
    expectTierCount(restoredMount.container, "gold", 1);
    expect(sessionStorage.getItem(benefitDraftStorageKey)).toBeNull();
  });

  it("keeps benefit drafts and retry keys separate when the same tab switches agencies", async () => {
    rejectPost = true;
    const mount = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getTab(mount.container, "gold").click();
    });

    const fillDraft = async (container: HTMLElement) => {
      const label = container.querySelector<HTMLInputElement>('[data-testid="club-benefit-label-input"]');
      const value = container.querySelector<HTMLInputElement>('[data-testid="club-benefit-value-input"]');
      const description = container.querySelector<HTMLInputElement>('[data-testid="club-benefit-description-input"]');
      const add = container.querySelector<HTMLButtonElement>('[data-testid="club-add-benefit"]');
      expect(label).not.toBeNull();
      expect(value).not.toBeNull();
      expect(description).not.toBeNull();
      expect(add).not.toBeNull();
      await act(async () => {
        setInputValue(label!, "Acesso ao lounge");
        setInputValue(value!, "1 acesso");
        setInputValue(description!, "Apresente o voucher");
        add!.click();
      });
    };

    await fillDraft(mount.container);
    const tenantAPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")[0];
    const tenantAKey = (tenantAPost?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"];
    expect(tenantAKey).toMatch(/^[0-9a-f-]{36}$/i);

    mockTenantId.value = "club-benefit-other-tenant";
    await mount.rerender(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tenantBLabel = mount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    expect(tenantBLabel?.value).toBe("");
    expect(mount.container.querySelector('[role="status"]')?.textContent ?? "")
      .not.toContain("Rascunho recuperado");
    expect(sessionStorage.getItem(otherTenantBenefitDraftStorageKey)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(benefitDraftStorageKey) ?? "null").attempt.idempotencyKey)
      .toBe(tenantAKey);

    await fillDraft(mount.container);
    const tenantBPosts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    const tenantBKey = (tenantBPosts[1]?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"];
    expect(tenantBKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(tenantBKey).not.toBe(tenantAKey);
    expect(JSON.parse(sessionStorage.getItem(otherTenantBenefitDraftStorageKey) ?? "null")
      .attempt.idempotencyKey).toBe(tenantBKey);
    expect(JSON.parse(sessionStorage.getItem(benefitDraftStorageKey) ?? "null")
      .attempt.idempotencyKey).toBe(tenantAKey);

    mockTenantId.value = "club-benefit-test-tenant";
    await mount.rerender(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mount.container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    )?.value).toBe("Acesso ao lounge");
    expect(mount.container.querySelector('[role="status"]')?.textContent)
      .toContain("Rascunho recuperado");

    rejectPost = false;
    const retryButton = mount.container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(retryButton).not.toBeNull();
    await act(async () => {
      retryButton!.click();
    });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts[2]?.[1]?.headers).toMatchObject({ "Idempotency-Key": tenantAKey });
  });

  it("removes recoverable draft data when the user discards it", async () => {
    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    expect(labelInput).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Rascunho descartável");
    });
    expect(sessionStorage.getItem(benefitDraftStorageKey)).not.toBeNull();

    const discardButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-discard-benefit-draft"]',
    );
    expect(discardButton).not.toBeNull();
    await act(async () => {
      discardButton!.click();
    });

    expect(labelInput!.value).toBe("");
    expect(sessionStorage.getItem(benefitDraftStorageKey)).toBeNull();
  });

  it("sends one creation for repeated clicks and keeps the fields available while pending", async () => {
    deferPost = true;
    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput).not.toBeNull();
    expect(valueInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    expect(addButton).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Acesso ao lounge");
      setInputValue(valueInput!, "1 acesso");
      setInputValue(descriptionInput!, "Apresente o voucher na entrada");
    });

    await act(async () => {
      addButton!.click();
      addButton!.click();
      addButton!.click();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(addButton!.disabled).toBe(true);
    expect(labelInput!.disabled).toBe(false);
    expect(valueInput!.disabled).toBe(false);
    expect(descriptionInput!.disabled).toBe(false);
    expect(labelInput!.value).toBe("Acesso ao lounge");
    expect(valueInput!.value).toBe("1 acesso");
    expect(descriptionInput!.value).toBe("Apresente o voucher na entrada");
    expect(container.querySelector('[data-testid="club-benefit-benefit-bronze"]')).toBeNull();
    expect(completePost).toBeTypeOf("function");

    await act(async () => {
      completePost?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(container.querySelector('[data-testid="club-benefit-created-after-pending"]')?.textContent)
      .toContain("Acesso ao lounge");
    expectTierCount(container, "bronze", 1);
    expect(labelInput!.value).toBe("");
    expect(valueInput!.value).toBe("");
    expect(descriptionInput!.value).toBe("");
  });

  it("preserves a newer draft when an earlier benefit creation finishes", async () => {
    deferPost = true;
    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-add-benefit"]',
    );
    expect(labelInput).not.toBeNull();
    expect(valueInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    expect(addButton).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Acesso ao lounge");
      setInputValue(valueInput!, "1 acesso");
      setInputValue(descriptionInput!, "Apresente o voucher na entrada");
    });
    await act(async () => {
      addButton!.click();
      await Promise.resolve();
    });

    await act(async () => {
      setInputValue(labelInput!, "Traslado executivo");
    });
    expect(labelInput!.disabled).toBe(false);
    expect(labelInput!.value).toBe("Traslado executivo");

    await act(async () => {
      completePost?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const savedBenefit = container.querySelector(
      '[data-testid="club-benefit-created-after-pending"]',
    );
    expect(savedBenefit?.textContent).toContain("Acesso ao lounge");
    expect(savedBenefit?.textContent).toContain("1 acesso");
    expect(savedBenefit?.textContent).toContain("Apresente o voucher na entrada");
    expect(labelInput!.value).toBe("Traslado executivo");
    expect(valueInput!.value).toBe("");
    expect(descriptionInput!.value).toBe("");
    expect(addButton!.disabled).toBe(false);
    const submittedPost = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(submittedPost?.[1]?.body))).toMatchObject({
      label: "Acesso ao lounge",
      value: "1 acesso",
      description: "Apresente o voucher na entrada",
    });
  });

  it("keeps the benefit and its count when the server rejects removal", async () => {
    benefitsForLoad = [{
      id: "gold-benefit-1",
      tier: "gold",
      benefitKey: "airport_transfer",
      label: "Traslado do aeroporto",
      description: "Na chegada à cidade",
      value: "1 traslado",
      sortOrder: 0,
    }];
    rejectDelete = true;

    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getTab(container, "gold").click();
    });

    const benefit = container.querySelector('[data-testid="club-benefit-gold-benefit-1"]');
    const removeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-delete-benefit-gold-benefit-1"]',
    );
    expect(benefit?.textContent).toContain("Traslado do aeroporto");
    expectTierCount(container, "gold", 1);
    expect(removeButton).not.toBeNull();

    await act(async () => {
      removeButton!.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/club/benefits/gold-benefit-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(container.querySelector('[data-testid="club-benefit-gold-benefit-1"]')?.textContent)
      .toContain("Traslado do aeroporto");
    expectTierCount(container, "gold", 1);
    expect(removeButton!.disabled).toBe(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Erro ao remover benefício",
        variant: "destructive",
      }),
    );
  });

  it("refreshes remote benefit changes without clearing the in-progress form draft", async () => {
    benefitsForLoad = [{
      id: "bronze-existing",
      tier: "bronze",
      benefitKey: "existing",
      label: "Benefício já cadastrado",
      description: null,
      value: null,
      sortOrder: 0,
    }];
    let pollBenefits: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number) => {
      expect(delay).toBe(30_000);
      pollBenefits = callback as () => void;
      return 1;
    }) as typeof window.setInterval);

    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const labelInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-label-input"]',
    );
    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-value-input"]',
    );
    const descriptionInput = container.querySelector<HTMLInputElement>(
      '[data-testid="club-benefit-description-input"]',
    );
    expect(labelInput).not.toBeNull();
    expect(valueInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();

    await act(async () => {
      setInputValue(labelInput!, "Rascunho do atendente");
      setInputValue(valueInput!, "15%");
      setInputValue(descriptionInput!, "Válido para o cliente");
    });

    benefitsForLoad.push({
      id: "silver-created-elsewhere",
      tier: "silver",
      benefitKey: "remote_benefit",
      label: "Criado por outra pessoa",
      description: null,
      value: "Cortesia",
      sortOrder: 0,
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      getTab(container, "silver").click();
    });
    expect(container.querySelector('[data-testid="club-benefit-silver-created-elsewhere"]')?.textContent)
      .toContain("Criado por outra pessoa");
    expectTierCount(container, "bronze", 1);
    expectTierCount(container, "silver", 1);
    await act(async () => {
      getTab(container, "bronze").click();
    });
    expect(labelInput!.value).toBe("Rascunho do atendente");
    expect(valueInput!.value).toBe("15%");
    expect(descriptionInput!.value).toBe("Válido para o cliente");

    benefitsForLoad.push({
      id: "diamond-created-by-poll",
      tier: "diamond",
      benefitKey: "remote_poll",
      label: "Atualizado pela consulta periódica",
      description: null,
      value: null,
      sortOrder: 0,
    });
    expect(pollBenefits).toBeDefined();
    await act(async () => {
      pollBenefits?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      getTab(container, "diamond").click();
    });
    expect(container.querySelector('[data-testid="club-benefit-diamond-created-by-poll"]')?.textContent)
      .toContain("Atualizado pela consulta periódica");
    expectTierCount(container, "diamond", 1);
    await act(async () => {
      getTab(container, "bronze").click();
    });
    expect(labelInput!.value).toBe("Rascunho do atendente");
    expect(valueInput!.value).toBe("15%");
    expect(descriptionInput!.value).toBe("Válido para o cliente");
    expect(fetchMock.mock.calls.filter(([, init]) => !init?.method || init.method === "GET")
      .filter(([url]) => String(url).endsWith("/api/club/benefits"))).toHaveLength(3);
  });

  it("sends only one removal when the same benefit is clicked repeatedly while pending", async () => {
    benefitsForLoad = [{
      id: "gold-pending",
      tier: "gold",
      benefitKey: "pending",
      label: "Benefício em remoção",
      description: null,
      value: null,
      sortOrder: 0,
    }];
    deferDelete = true;

    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getTab(container, "gold").click();
    });
    const removeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-delete-benefit-gold-pending"]',
    );
    expect(removeButton).not.toBeNull();

    await act(async () => {
      removeButton!.click();
      removeButton!.click();
      removeButton!.click();
      await Promise.resolve();
    });

    expect(removeButton!.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(container.querySelector('[data-testid="club-benefit-gold-pending"]')).not.toBeNull();
    expectTierCount(container, "gold", 1);
    expect(completeDelete).toBeTypeOf("function");

    await act(async () => {
      completeDelete?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(container.querySelector('[data-testid="club-benefit-gold-pending"]')).toBeNull();
    expectTierCount(container, "gold", 0);
  });

  it("keeps each removal busy until its own request finishes", async () => {
    benefitsForLoad = [
      {
        id: "gold-first",
        tier: "gold",
        benefitKey: "first",
        label: "Primeiro benefício",
        description: null,
        value: null,
        sortOrder: 0,
      },
      {
        id: "gold-second",
        tier: "gold",
        benefitKey: "second",
        label: "Segundo benefício",
        description: null,
        value: null,
        sortOrder: 1,
      },
    ];
    deferDelete = true;

    const { container } = await renderComponent(createElement(ClubConfigTab));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      getTab(container, "gold").click();
    });

    const firstButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-delete-benefit-gold-first"]',
    );
    const secondButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="club-delete-benefit-gold-second"]',
    );
    expect(firstButton).not.toBeNull();
    expect(secondButton).not.toBeNull();

    await act(async () => {
      firstButton!.click();
      secondButton!.click();
      await Promise.resolve();
    });

    expect(firstButton!.disabled).toBe(true);
    expect(secondButton!.disabled).toBe(true);
    expect(firstButton!.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
    expect(secondButton!.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
    expect(completeDeletes.size).toBe(2);

    await act(async () => {
      completeDeletes.get("gold-first")?.(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-benefit-gold-first"]')).not.toBeNull();
    expect(firstButton!.disabled).toBe(false);
    expect(secondButton!.disabled).toBe(true);
    expect(secondButton!.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
    expectTierCount(container, "gold", 2);

    await act(async () => {
      completeDeletes.get("gold-second")?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="club-benefit-gold-second"]')).toBeNull();
    expect(container.querySelector('[data-testid="club-benefit-gold-first"]')).not.toBeNull();
    expect(firstButton!.disabled).toBe(false);
    expectTierCount(container, "gold", 1);
  });
});
