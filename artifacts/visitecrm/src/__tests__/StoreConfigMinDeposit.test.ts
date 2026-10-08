import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import that uses them.
// ---------------------------------------------------------------------------
const mockGetSettings = vi.hoisted(() => vi.fn());
const mockUpdateSettings = vi.hoisted(() => vi.fn());
const mockTestStripeConnection = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
    testStripeConnection: mockTestStripeConnection,
  },
  InitStoreInput: {},
  StoreSettings: {},
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/loja/configuracoes", vi.fn()],
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: true, user: { id: "user-1" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,FAKE")),
  },
}));

vi.mock("@/components/cover-image-upload", () => ({
  CoverImageUpload: () => createElement("div", { "data-testid": "cover-upload" }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, className, variant, ...rest }: Record<string, unknown>) =>
    createElement(
      "button",
      { onClick, disabled: Boolean(disabled), type: type as string, className: (className as string) || "", ...rest },
      children as never
    ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) =>
    createElement("input", {
      type: (props.type as string) || "text",
      value: (props.value as string) ?? "",
      onChange: props.onChange as (e: { target: { value: string } }) => void,
      placeholder: (props.placeholder as string) || "",
      step: (props.step as string) || undefined,
      min: (props.min as string) || undefined,
      className: (props.className as string) || "",
      id: (props.id as string) || undefined,
      autoComplete: (props.autoComplete as string) || undefined,
      "aria-invalid": props["aria-invalid"] as boolean | undefined,
      "aria-describedby": (props["aria-describedby"] as string) || undefined,
      "data-testid": (props["data-testid"] as string) || undefined,
    }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) => createElement("label", null, children as never),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) =>
    createElement("textarea", {
      value: (props.value as string) || "",
      onChange: props.onChange as (e: { target: { value: string } }) => void,
      placeholder: (props.placeholder as string) || "",
    }),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    [key: string]: unknown;
  }) =>
    createElement("input", {
      type: "checkbox",
      checked,
      onChange: (e: { target: { checked: boolean } }) => onCheckedChange(e.target.checked),
      ...rest,
    }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) => createElement("span", null, children as never),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => createElement("hr"),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children: unknown; className?: string }) =>
    createElement("div", { className: className || "" }, children as never),
  CardHeader: ({ children }: { children: unknown }) => createElement("div", null, children as never),
  CardTitle: ({ children }: { children: unknown }) => createElement("h3", null, children as never),
  CardDescription: ({ children }: { children: unknown }) => createElement("p", null, children as never),
  CardContent: ({ children, className }: { children: unknown; className?: string }) =>
    createElement("div", { className: className || "" }, children as never),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, defaultValue }: { children: unknown; defaultValue?: string }) =>
    createElement("div", { "data-active-tab": defaultValue }, children as never),
  TabsList: ({ children }: { children: unknown }) => createElement("div", null, children as never),
  TabsTrigger: ({ children, value }: { children: unknown; value: string }) =>
    createElement("button", { "data-tab": value }, children as never),
  TabsContent: ({ children, value }: { children: unknown; value: string }) =>
    createElement("div", { "data-tab-content": value }, children as never),
}));

// ---------------------------------------------------------------------------
// Import component under test AFTER all vi.mock declarations.
// ---------------------------------------------------------------------------
const { default: LojaConfiguracoes } = await import("../pages/loja/configuracoes.js");

describe("LojaConfiguracoes — Valor M\u00ednimo de Reserva", () => {
  beforeEach(async () => {
    await cleanupRoots();
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockTestStripeConnection.mockReset();
    mockToast.mockReset();
  });

  afterEach(async () => {
    await cleanupRoots();
  });

  function storeFixture(overrides: Record<string, unknown> = {}) {
    return {
      name: "Minha Loja",
      slug: "minha-loja",
      isActive: true,
      maintenanceMode: false,
      minDepositAmount: null,
      minOrderValue: null,
      paymentMethods: [],
      ...overrides,
    };
  }

  it("pre-popula o campo minDepositAmount com o valor atual da loja", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({ minDepositAmount: "150.00" }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const depositInput = container.querySelector(
      'input[data-testid="min-deposit-amount"]'
    ) as HTMLInputElement | null;

    expect(depositInput).not.toBeNull();
    expect(depositInput?.value).toBe("150.00");
  });

  it("renderiza o campo Valor Mínimo de Reserva com placeholder e label corretos", async () => {
    // Use a recognisable value so we can locate the right input by its value.
    mockGetSettings.mockResolvedValue(storeFixture({ minDepositAmount: "77.00" }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    // The Pagamentos tab (all TabsContent rendered by the mock) contains two
    // type=number inputs: minOrderValue (index 0) and minDepositAmount (index 1).
    const depositInput = Array.from(
      container.querySelectorAll('input[type="number"]')
    ).find((el) => (el as HTMLInputElement).value === "77.00") as HTMLInputElement | undefined;

    expect(depositInput).toBeDefined();
    expect(depositInput?.getAttribute("placeholder")).toBe("0,00");
    expect(depositInput?.getAttribute("step")).toBe("0.01");

    // Label and help text are present in the rendered tree.
    expect(container.textContent).toContain("Valor Mínimo de Reserva (R$)");
    expect(container.textContent).toContain(
      "Permite que clientes paguem apenas este valor mínimo no checkout"
    );
  });

  it("campo vazio quando minDepositAmount não está configurado", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({ minDepositAmount: null }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const depositInput = container.querySelector(
      'input[data-testid="min-deposit-amount"]'
    ) as HTMLInputElement | null;
    expect(depositInput).not.toBeNull();
    expect(depositInput?.value).toBe("");
  });

  it("chama updateSettings com minDepositAmount ao salvar", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({ minDepositAmount: "90.00" }));
    mockUpdateSettings.mockResolvedValue(storeFixture({ minDepositAmount: "90.00" }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    // Click the save button
    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();

    await flushAct(() => {
      saveBtn!.click();
    });

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const payload = mockUpdateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ minDepositAmount: "90.00" });
  });

  it("envia minDepositAmount como null quando o campo está vazio", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({ minDepositAmount: null }));
    mockUpdateSettings.mockResolvedValue(storeFixture({ minDepositAmount: null }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();

    await flushAct(() => {
      saveBtn!.click();
    });

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const payload = mockUpdateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.minDepositAmount == null).toBe(true);
  });

  it("mostra que a chave salva está protegida sem expor seu valor", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      paymentMethods: ["pix"],
      pixEnabled: true,
      pixKeyConfigured: true,
      pixKeyType: "email",
    }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const keyInput = container.querySelector(
      'input[placeholder="Digite uma nova chave para substituir"]'
    ) as HTMLInputElement | null;
    expect(keyInput).not.toBeNull();
    expect(keyInput?.type).toBe("password");
    expect(container.textContent).toContain("Há uma chave Pix protegida cadastrada.");
    expect(container.textContent).toContain("Deixe o campo vazio para mantê-la");
    expect(container.textContent).toContain("Informe o endereço de e-mail cadastrado como chave Pix.");
  });

  it("não permite ativar o Pix Manual sem uma chave configurada", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      paymentMethods: ["pix"],
      pixEnabled: false,
      pixKeyConfigured: false,
    }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const pixSwitch = container.querySelector(
      "#pix-manual-enabled"
    ) as HTMLInputElement | null;
    expect(pixSwitch).not.toBeNull();
    await flushAct(() => pixSwitch!.click());

    expect(container.textContent).toContain("Cadastre uma chave Pix antes de ativar");
    const saveBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();
    await flushAct(() => saveBtn!.click());

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("Cadastre uma chave Pix"),
    }));
  });

  it("não permite alterar o tipo de uma chave salva sem informar uma substituta", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      paymentMethods: ["pix"],
      pixEnabled: true,
      pixKeyConfigured: true,
      pixKeyType: "email",
    }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const keyType = container.querySelector(
      "#pix-manual-key-type"
    ) as HTMLSelectElement | null;
    expect(keyType).not.toBeNull();
    await flushAct(() => {
      keyType!.value = "phone";
      keyType!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("informe também a nova chave Pix");
    const saveBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();
    await flushAct(() => saveBtn!.click());

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining("nova chave Pix"),
    }));
  });

  it("omite o campo Pix vazio ao salvar para preservar a chave protegida", async () => {
    const settings = storeFixture({
      paymentMethods: ["pix"],
      pixEnabled: true,
      pixKeyConfigured: true,
      pixKeyType: "email",
    });
    mockGetSettings.mockResolvedValue(settings);
    mockUpdateSettings.mockResolvedValue(settings);

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const saveBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();
    await flushAct(() => saveBtn!.click());

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const payload = mockUpdateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("pixKey");
    expect(payload).toMatchObject({ pixEnabled: true, pixKeyType: "email" });
  });

  it("exibe a configuração Stripe para Pix e mostra o endpoint específico da loja", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      paymentMethods: ["pix"],
      stripeEnabled: true,
      stripePublicKey: "pk_test_public123",
      stripeSecretKeyConfigured: true,
      stripeWebhookSecretConfigured: false,
    }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    expect(container.textContent).toContain("Configure e teste as credenciais antes de ativar cobranças.");
    expect(container.querySelector('[data-testid="stripe-public-key"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stripe-webhook-url"]')?.textContent).toContain(
      "/api/webhooks/stripe/minha-loja",
    );
    expect(container.textContent).toContain("payment_intent.succeeded");
    expect(container.textContent).toContain("charge.dispute.created");
  });

  it("testa uma chave nova antes de ativar o Stripe sem salvar as configurações", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      stripeEnabled: false,
      stripePublicKey: "pk_test_public123",
      stripeSecretKeyConfigured: false,
      paymentMethods: [],
    }));
    mockTestStripeConnection.mockResolvedValue({ connected: true, livemode: false });

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const secretInput = container.querySelector(
      '[data-testid="stripe-secret-key"]',
    ) as HTMLInputElement | null;
    const testButton = container.querySelector(
      '[data-testid="test-stripe-connection"]',
    ) as HTMLButtonElement | null;
    expect(secretInput).not.toBeNull();
    expect(testButton).not.toBeNull();
    expect(testButton?.disabled).toBe(false);

    await flushAct(() => {
      const setNativeValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setNativeValue?.call(secretInput, "sk_test_candidate123");
      secretInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(secretInput?.value).toBe("sk_test_candidate123");
    await flushAct(() => testButton!.click());

    expect(mockTestStripeConnection).toHaveBeenCalledWith({
      secretKey: "sk_test_candidate123",
    });
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Conexão verificada no ambiente de teste.");
  });

  it("mostra a falha da verificação sem alterar a chave salva", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      stripeEnabled: false,
      stripePublicKey: "pk_test_public123",
      stripeSecretKeyConfigured: true,
      paymentMethods: [],
    }));
    mockTestStripeConnection.mockRejectedValue(
      new Error("A Stripe rejeitou a chave secreta. Verifique se ela continua ativa."),
    );

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const testButton = container.querySelector(
      '[data-testid="test-stripe-connection"]',
    ) as HTMLButtonElement | null;
    expect(testButton).not.toBeNull();
    await flushAct(() => testButton!.click());

    expect(mockTestStripeConnection).toHaveBeenCalledWith({});
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "continua ativa",
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("bloqueia a ativação do Stripe sem chaves públicas e secretas", async () => {
    mockGetSettings.mockResolvedValue(storeFixture({
      paymentMethods: ["credit_card"],
      stripeEnabled: false,
      stripeSecretKeyConfigured: false,
    }));

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const stripeSwitch = container.querySelector(
      '[data-testid="stripe-enabled"]',
    ) as HTMLInputElement | null;
    expect(stripeSwitch).not.toBeNull();
    await flushAct(() => stripeSwitch!.click());

    expect(container.textContent).toContain("Informe a chave pública do Stripe.");
    expect(container.textContent).toContain("Informe a chave secreta do Stripe.");

    const saveBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();
    await flushAct(() => saveBtn!.click());

    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Informe a chave pública do Stripe.",
    }));
  });

  it("não envia campos secretos vazios ao salvar configurações Stripe", async () => {
    const settings = storeFixture({
      paymentMethods: ["credit_card"],
      stripeEnabled: true,
      stripePublicKey: "pk_test_public123",
      stripeSecretKeyConfigured: true,
      stripeWebhookSecretConfigured: true,
    });
    mockGetSettings.mockResolvedValue(settings);
    mockUpdateSettings.mockResolvedValue(settings);

    const { container } = await renderComponent(createElement(LojaConfiguracoes));
    await flushAct(() => {});

    const saveBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Salvar")
    ) as HTMLButtonElement | undefined;
    expect(saveBtn).toBeDefined();
    await flushAct(() => saveBtn!.click());

    expect(mockUpdateSettings).toHaveBeenCalledOnce();
    const payload = mockUpdateSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("stripeSecretKey");
    expect(payload).not.toHaveProperty("stripeWebhookSecret");
  });
});
