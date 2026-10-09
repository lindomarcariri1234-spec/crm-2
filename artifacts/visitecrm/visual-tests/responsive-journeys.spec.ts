import { expect, test, type Locator, type Page } from "@playwright/test";

const widths = [
  { label: "celular", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 900 },
];

const storefrontScenarios = [
  "catalogo",
  "calendario",
  "comparar",
  "produto",
  "reserva",
  "checkout",
  "pedido",
  "entrar",
  "cadastrar",
  "indicacao",
] as const;

const syntheticCustomer = {
  name: "Viajante de Teste",
  email: "checkout@example.invalid",
  phone: "(11) 99999-9999",
  cpf: "52998224725",
};

const syntheticCoPassengers = [
  { name: "Acompanhante Dois", cpf: "111.444.777-35", phone: "(88) 98888-1111" },
  { name: "Acompanhante Três", cpf: "935.411.347-80", phone: "(88) 97777-2222" },
];

const stripeThreeDSModes = [
  { label: "test mode", mode: "test", showsNoChargeNotice: true },
  { label: "live mode", mode: "live", showsNoChargeNotice: false },
  { label: "unknown Stripe mode", mode: "unknown", showsNoChargeNotice: false },
] as const;

const recoveredOrderNumber = "VIS-3DS-001";
const recoveredOrderToken = "visual-3ds-payment-token";
const recoveredPaymentIntentId = "pi_visual_3ds";

async function openFixture(page: Page, scenario: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/visual-tests/index.html?scenario=${scenario}`);
  await expect(page.locator("#visual-test-root")).toBeVisible();
  await expect(page.locator("#visual-test-root")).not.toContainText("Cenário de teste desconhecido.");
}

async function clickFlowButton(page: Page, label: string) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button, `${label} should be visible and enabled`).toBeVisible();
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await expect(button, `${label} should fit in the viewport`).toBeInViewport();
  await button.click();
}

async function assertDisplayedTripTotal(
  page: Page,
  stage: string,
  expectedTotal = 2650,
  expectedLabel = "Total líquido",
) {
  const totalLabel = page.getByText(expectedLabel, { exact: true }).last();
  await expect(totalLabel, `${stage} should show a total`).toBeVisible();
  const ptBrTotal = expectedTotal.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const englishTotal = expectedTotal.toFixed(2);
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(totalLabel.locator(".."), `${stage} should preserve the fixture total`).toContainText(
    new RegExp(`${escapeRegExp(ptBrTotal)}|${escapeRegExp(englishTotal)}`),
  );
}

async function assertSyntheticOrderRequest(
  page: Page,
  quantity = 1,
  coPassengers: typeof syntheticCoPassengers | [] = [],
) {
  const request = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem("visual-test:last-order-request");
    return raw ? JSON.parse(raw) : null;
  }) as {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    paymentMethod?: string;
    items?: Array<{ productId?: string; productName?: string; quantity?: number; unitPrice?: number }>;
    coPassengers?: Array<{ name?: string; cpf?: string; phone?: string }>;
  } | null;

  expect(request, "the mocked order endpoint should capture the synthetic submission").not.toBeNull();
  expect(request).toMatchObject({
    customerName: syntheticCustomer.name,
    customerEmail: syntheticCustomer.email,
    customerPhone: syntheticCustomer.phone,
    paymentMethod: "pix",
  });
  expect(request?.items).toHaveLength(1);
  expect(request?.items?.[0]).toMatchObject({
    productId: "visual-product-fixture",
    productName: "Rota dos Geossítios do Araripe",
    quantity,
    unitPrice: 2650,
  });
  if (coPassengers.length > 0) {
    expect(request?.coPassengers).toEqual(coPassengers);
  } else {
    expect(request).not.toHaveProperty("coPassengers");
  }
}

async function assertNoSyntheticOrderRequest(page: Page, stage: string) {
  const request = await page.evaluate(() => window.sessionStorage.getItem("visual-test:last-order-request"));
  expect(request, `no order POST should occur while ${stage}`).toBeNull();
}

async function readVisualSessionCounter(page: Page, key: string) {
  return page.evaluate(
    (storageKey) => Number(window.sessionStorage.getItem(storageKey) ?? "0"),
    key,
  );
}

async function assertStripeNoChargeNotice(page: Page, shouldBeVisible: boolean) {
  const notice = page.getByTestId("stripe-test-payment-warning");
  if (shouldBeVisible) {
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Nenhuma cobrança real foi realizada neste pedido.");
    return;
  }

  await expect(notice).toHaveCount(0);
  await expect(page.getByText("Pagamento Stripe em modo de teste", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Nenhuma cobrança real foi realizada neste pedido.", { exact: true }),
  ).toHaveCount(0);
}

async function assertNoDocumentOverflow(page: Page, scenario: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(
    dimensions.document,
    `${scenario}: document overflow ${dimensions.document}px > viewport ${dimensions.viewport}px`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(
    dimensions.body,
    `${scenario}: body overflow ${dimensions.body}px > viewport ${dimensions.viewport}px`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function assertReachable(locator: Locator, page: Page, label: string) {
  await expect(locator, `${label} should be rendered`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have measurable layout`).not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(box.width, `${label} should not collapse to zero width`).toBeGreaterThan(0);
  expect(box.height, `${label} should not collapse to zero height`).toBeGreaterThan(0);
  expect(box.x, `${label} should not be clipped on the left`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} should not be clipped on the right`).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  await locator.focus();
  await expect(locator, `${label} should be keyboard reachable`).toBeFocused();
}

for (const viewport of widths) {
  test(`portal tabs stay navigable at ${viewport.label} width`, async ({ page }) => {
    await openFixture(page, "perfil", viewport.width, viewport.height);
    const rail = page.locator("#portal-tabs");
    await expect(rail).toBeVisible();
    await expect(page.getByTestId("tab-inicio")).toBeVisible();

    const railOverflow = await rail.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    if (viewport.width < 640) {
      expect(railOverflow.scrollWidth).toBeGreaterThan(railOverflow.clientWidth);
    } else {
      expect(railOverflow.scrollWidth).toBeLessThanOrEqual(railOverflow.clientWidth + 1);
    }

    const tabs = [
      "inicio",
      "reservas",
      "dados",
      "indicacoes",
      "fidelidade",
      "preferencias",
      "favoritos",
      "conquistas",
      "mapa",
      "sonhos",
      "memorias",
      "clube",
    ];

    for (const tab of tabs) {
      const trigger = page.getByTestId(`tab-${tab}`);
      await rail.scrollIntoViewIfNeeded();
      await trigger.evaluate((element) => {
        const rail = element.closest("#portal-tabs");
        if (!rail) throw new Error("Portal tab is not inside its navigation rail.");
        const rect = element.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        const delta = rect.left + rect.width / 2 - (railRect.left + rail.clientWidth / 2);
        const maxScroll = rail.scrollWidth - rail.clientWidth;
        rail.scrollLeft = Math.max(0, Math.min(maxScroll, rail.scrollLeft + delta));
      });
      if ((await trigger.getAttribute("data-state")) !== "active") {
        await expect(trigger).toBeInViewport();
        await trigger.click();
      }
      await expect(trigger).toHaveAttribute("data-state", "active");
      const panel = page.locator('[role="tabpanel"][data-state="active"]');
      await expect(panel).toBeVisible();

      const panelText = (await panel.innerText()).trim();
      expect(panelText, `${tab} tab should show fixture content`).not.toBe("");

      const firstAction = panel.locator("button:not(:disabled):visible, a[href]:visible, input:not(:disabled):visible, textarea:visible, select:visible").first();
      if (await firstAction.count()) {
        await firstAction.scrollIntoViewIfNeeded();
        await assertReachable(firstAction, page, `portal ${tab} action`);
      }

      const triggerGeometry = await trigger.evaluate((element) => {
        const rail = element.closest("#portal-tabs");
        const railRect = rail?.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return {
          intersects: !!railRect && rect.right > railRect.left && rect.left < railRect.right,
          railScrollLeft: rail?.scrollLeft ?? null,
          railClientWidth: rail?.clientWidth ?? null,
          railScrollWidth: rail?.scrollWidth ?? null,
          railRect: railRect ? { left: railRect.left, right: railRect.right } : null,
          triggerRect: { left: rect.left, right: rect.right },
        };
      });
      expect(
        triggerGeometry.intersects,
        `${tab} tab should remain reachable in the tab rail: ${JSON.stringify(triggerGeometry)}`,
      ).toBe(true);
      await assertNoDocumentOverflow(page, `portal ${tab}`);
    }
  });

  test(`reservation flow completes with synthetic details at ${viewport.label} width`, async ({ page }) => {
    await openFixture(page, "reserva", viewport.width, viewport.height);
    await page.locator("#name").fill(syntheticCustomer.name);
    await page.locator("#email").fill(syntheticCustomer.email);
    await page.locator("#phone").fill(syntheticCustomer.phone);
    await page.locator("#cpf").fill(syntheticCustomer.cpf);
    await assertNoDocumentOverflow(page, `reservation details at ${viewport.label}`);

    await clickFlowButton(page, "Continuar");
    await expect(page.getByRole("heading", { name: "Revisão do Pedido" })).toBeVisible();
    await expect(page.getByText("Rota dos Geossítios do Araripe").first()).toBeVisible();
    await assertDisplayedTripTotal(page, `reservation review at ${viewport.label}`);

    await clickFlowButton(page, "Continuar");
    await expect(page.getByRole("heading", { name: "Forma de Pagamento" })).toBeVisible();
    await page.locator('input[name="payment_method"][value="pix"]').check();
    await assertDisplayedTripTotal(page, `reservation payment at ${viewport.label}`);
    await assertNoDocumentOverflow(page, `reservation payment at ${viewport.label}`);

    await clickFlowButton(page, "Confirmar Reserva");
    await expect(page.getByRole("heading", { name: /Pedido Realizado!/ })).toBeVisible();
    await expect(page.getByText("VIS-TESTE-001", { exact: true }).first()).toBeVisible();
    await assertSyntheticOrderRequest(page);
    await assertNoDocumentOverflow(page, `reservation confirmation at ${viewport.label}`);
  });

  test(`reservation data blocks invalid CPF and phone at ${viewport.label} width`, async ({ page }) => {
    await openFixture(page, "reserva", viewport.width, viewport.height);
    await page.locator("#name").fill(syntheticCustomer.name);
    await page.locator("#email").fill(syntheticCustomer.email);
    await page.locator("#phone").fill(syntheticCustomer.phone);
    await page.locator("#cpf").fill("11111111111");

    const continueButton = page.getByRole("button", { name: "Continuar", exact: true });
    const dataHeading = page.getByRole("heading", { name: "Seus Dados" });
    const reviewHeading = page.getByRole("heading", { name: "Revisão do Pedido" });

    await expect(page.getByText("CPF inválido", { exact: true })).toBeVisible();
    await expect(continueButton).toBeDisabled();
    await expect(dataHeading).toBeVisible();
    await expect(reviewHeading).not.toBeVisible();
    await assertNoSyntheticOrderRequest(page, "the CPF is invalid");

    await page.locator("#cpf").fill(syntheticCustomer.cpf);
    await page.locator("#phone").fill("12345");
    await expect(page.getByText(/Telefone inválido/)).toBeVisible();
    await expect(continueButton).toBeDisabled();
    await expect(dataHeading).toBeVisible();
    await expect(reviewHeading).not.toBeVisible();
    await assertNoSyntheticOrderRequest(page, "the phone is invalid");

    await page.locator("#phone").fill(syntheticCustomer.phone);
    await expect(continueButton).toBeEnabled();
    await assertNoSyntheticOrderRequest(page, "valid passenger details have not been confirmed");

    await clickFlowButton(page, "Continuar");
    await expect(reviewHeading).toBeVisible();
    await assertNoSyntheticOrderRequest(page, "the order has not been confirmed");
  });

  test(`group reservation preserves each companion at ${viewport.label} width`, async ({ page }) => {
    await openFixture(page, "reserva", viewport.width, viewport.height);
    await page.locator("#name").fill(syntheticCustomer.name);
    await page.locator("#email").fill(syntheticCustomer.email);
    await page.locator("#phone").fill(syntheticCustomer.phone);
    await page.locator("#cpf").fill(syntheticCustomer.cpf);
    await page.locator("select").first().selectOption("3");

    // Fill the third passenger first to ensure a sparse state cannot bypass validation.
    await page.locator("#co-name-1").fill(syntheticCoPassengers[1].name);
    await page.locator("#co-cpf-1").fill(syntheticCoPassengers[1].cpf.replace(/\D/g, ""));
    await page.locator("#co-phone-1").fill(syntheticCoPassengers[1].phone);
    const continueButton = page.getByRole("button", { name: "Continuar", exact: true });
    await expect(continueButton).toBeDisabled();

    await page.locator("#co-name-0").fill(syntheticCoPassengers[0].name);
    await page.locator("#co-cpf-0").fill(syntheticCoPassengers[0].cpf.replace(/\D/g, ""));
    await page.locator("#co-phone-0").fill(syntheticCoPassengers[0].phone);
    await expect(continueButton).toBeEnabled();
    await assertNoDocumentOverflow(page, `group reservation details at ${viewport.label}`);

    await clickFlowButton(page, "Continuar");
    await expect(page.getByRole("heading", { name: "Revisão do Pedido" })).toBeVisible();
    await expect(page.getByTestId("review-passenger-quantity")).toHaveText("3");
    for (const [index, passenger] of syntheticCoPassengers.entries()) {
      await expect(page.getByText(`Passageiro ${index + 2}: ${passenger.name}`, { exact: true })).toBeVisible();
    }
    await assertDisplayedTripTotal(page, `group reservation review at ${viewport.label}`, 7950);

    await page.getByRole("button", { name: "−", exact: true }).click();
    await page.getByRole("button", { name: "+", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeDisabled();
    await expect(page.getByText(/Volte à etapa anterior e informe os dados dos novos acompanhantes/)).toBeVisible();
    await page.getByRole("button", { name: "Voltar", exact: true }).last().click();
    await page.locator("#co-name-1").fill(syntheticCoPassengers[1].name);
    await page.locator("#co-cpf-1").fill(syntheticCoPassengers[1].cpf.replace(/\D/g, ""));
    await page.locator("#co-phone-1").fill(syntheticCoPassengers[1].phone);
    await clickFlowButton(page, "Continuar");
    await expect(page.getByTestId("review-passenger-quantity")).toHaveText("3");
    await assertDisplayedTripTotal(page, `group reservation updated review at ${viewport.label}`, 7950);

    await clickFlowButton(page, "Continuar");
    await expect(page.getByRole("heading", { name: "Forma de Pagamento" })).toBeVisible();
    await page.locator('input[name="payment_method"][value="pix"]').check();
    await assertDisplayedTripTotal(page, `group reservation payment at ${viewport.label}`, 7950);
    await assertNoDocumentOverflow(page, `group reservation payment at ${viewport.label}`);

    await clickFlowButton(page, "Confirmar Reserva");
    await expect(page.getByRole("heading", { name: /Pedido Realizado!/ })).toBeVisible();
    await expect(page.getByTestId("confirmation-passenger-count")).toHaveText("3 passageiros");
    for (const [index, passenger] of syntheticCoPassengers.entries()) {
      await expect(page.getByText(`Passageiro ${index + 2}: ${passenger.name}`, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("heading", { name: "Resumo Financeiro" }).locator(".."),
    ).toContainText("R$ 7950.00");
    await assertSyntheticOrderRequest(page, 3, syntheticCoPassengers);
    await assertNoDocumentOverflow(page, `group reservation confirmation at ${viewport.label}`);
  });

  test(`checkout flow completes with synthetic details at ${viewport.label} width`, async ({ page }) => {
    await openFixture(page, "checkout", viewport.width, viewport.height);
    await page.getByPlaceholder("Seu nome completo").fill(syntheticCustomer.name);
    await page.getByPlaceholder("seu@email.com").fill(syntheticCustomer.email);
    await page.getByPlaceholder("(11) 99999-9999").fill(syntheticCustomer.phone);
    await assertNoDocumentOverflow(page, `checkout details at ${viewport.label}`);

    await clickFlowButton(page, "Continuar");
    await expect(page.getByText("Revisão dos Itens", { exact: true })).toBeVisible();
    await expect(page.getByText("Rota dos Geossítios do Araripe").first()).toBeVisible();
    await assertDisplayedTripTotal(page, `checkout review at ${viewport.label}`, 2650, "Total");

    await clickFlowButton(page, "Ir para Pagamento");
    await expect(page.getByText("Forma de Pagamento", { exact: false }).first()).toBeVisible();
    await assertDisplayedTripTotal(page, `checkout payment at ${viewport.label}`, 2650, "Total");
    await assertNoDocumentOverflow(page, `checkout payment at ${viewport.label}`);

    await clickFlowButton(page, "Confirmar Pedido");
    await expect(
      page.getByRole("heading", { name: "Pedido recebido — pagamento pendente" }),
    ).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Obrigado pela sua compra, ${syntheticCustomer.name}!`)),
    ).toBeVisible();
    await expect(page.getByText("VIS-TESTE-001", { exact: true }).first()).toBeVisible();
    await assertSyntheticOrderRequest(page);
    await assertNoDocumentOverflow(page, `checkout confirmation at ${viewport.label}`);
  });

  for (const scenario of storefrontScenarios) {
    test(`public storefront ${scenario} keeps content and actions visible at ${viewport.label} width`, async ({ page }) => {
      await openFixture(page, scenario, viewport.width, viewport.height);
      const heading = page.locator("h1").first();
      await expect(heading, `${scenario} should render its page heading`).toBeVisible();

      const actions = page.locator(
        "button:not(:disabled):visible, a[href]:visible, input:not(:disabled):visible, textarea:visible, select:visible",
      );
      await expect(actions.first(), `${scenario} should expose a usable form or primary action`).toBeVisible();
      await actions.first().scrollIntoViewIfNeeded();
      await assertReachable(actions.first(), page, `${scenario} primary action`);
      await assertNoDocumentOverflow(page, `storefront ${scenario}`);

      if (["checkout", "pedido", "entrar", "cadastrar"].includes(scenario)) {
        const visibleFields = page.locator("input:visible, textarea:visible, select:visible");
        await expect(visibleFields.first(), `${scenario} should show its form fields`).toBeVisible();
      }

      if (scenario === "checkout") {
        await expect(page.getByText(/Total/i).first()).toBeVisible();
        await expect(page.getByText(/2\.650,00|2650\.00/).first()).toBeVisible();
      }
    });
  }
}

test("customer reservation history labels only Stripe test-mode payments", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    "/visual-tests/index.html?scenario=perfil&reservationModeFixtures=true",
  );
  const reservationsTab = page.getByTestId("tab-reservas");
  await expect(reservationsTab).toBeVisible();
  await reservationsTab.click();

  await expect(page.getByText("Reserva Stripe em modo de teste", { exact: true })).toBeVisible();
  await expect(page.getByText("Reserva Stripe em produção", { exact: true })).toBeVisible();
  await expect(page.getByText("Reserva Stripe sem modo conhecido", { exact: true })).toBeVisible();
  await expect(page.getByText("Reserva com pagamento manual", { exact: true })).toBeVisible();
  await expect(page.getByTestId("stripe-test-payment-warning")).toHaveCount(1);
  await expect(
    page.getByText("Nenhuma cobrança real foi realizada nesta reserva.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Nenhuma cobrança real foi realizada neste pedido.", { exact: true }),
  ).toHaveCount(0);
});

test("manual order lookup replaces a Stripe test warning and clears old details after a failed lookup", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("visual-test:manual-order-lookup-count", "0");
    window.sessionStorage.setItem("visual-test:create-payment-intent-count", "0");
    window.sessionStorage.removeItem("visual-test:last-order-request");
  });
  await openFixture(page, "pedido", 1280, 900);

  const orderNumber = page.getByLabel("Número do Pedido");
  const accessCode = page.getByLabel("Código de Acesso");
  const lookupCount = () => readVisualSessionCounter(page, "visual-test:manual-order-lookup-count");

  await orderNumber.fill("VIS-TRACK-TEST");
  await accessCode.fill("visual-manual-lookup-token");
  await clickFlowButton(page, "Consultar Pedido");
  await expect(page.getByText("VIS-TRACK-TEST", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente Stripe Teste", { exact: true })).toBeVisible();
  await assertStripeNoChargeNotice(page, true);
  await expect.poll(lookupCount).toBe(1);

  await page.evaluate(() => window.sessionStorage.setItem("visual-test:tracking-lookup-delay-ms", "250"));
  await orderNumber.fill("VIS-TRACK-LIVE");
  await clickFlowButton(page, "Consultar Pedido");
  await expect(page.getByText("VIS-TRACK-TEST", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cliente Stripe Teste", { exact: true })).toHaveCount(0);
  await assertStripeNoChargeNotice(page, false);
  await expect(page.getByText("VIS-TRACK-LIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente Stripe Produção", { exact: true })).toBeVisible();
  await assertStripeNoChargeNotice(page, false);
  await expect.poll(lookupCount).toBe(2);

  await page.evaluate(() => window.sessionStorage.removeItem("visual-test:tracking-lookup-delay-ms"));
  await orderNumber.fill("VIS-TRACK-TEST");
  await clickFlowButton(page, "Consultar Pedido");
  await expect(page.getByText("VIS-TRACK-TEST", { exact: true })).toBeVisible();
  await expect(page.getByText("Cliente Stripe Teste", { exact: true })).toBeVisible();
  await assertStripeNoChargeNotice(page, true);
  await expect.poll(lookupCount).toBe(3);

  await page.evaluate(() => window.sessionStorage.setItem("visual-test:tracking-lookup-delay-ms", "250"));
  await orderNumber.fill("VIS-TRACK-FAILED");
  await clickFlowButton(page, "Consultar Pedido");
  await expect(page.getByText("VIS-TRACK-TEST", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cliente Stripe Teste", { exact: true })).toHaveCount(0);
  await assertStripeNoChargeNotice(page, false);
  await expect(
    page.getByText("Pedido não encontrado. Verifique o número do pedido e o código de acesso."),
  ).toBeVisible();
  await expect.poll(lookupCount).toBe(4);
  await assertNoSyntheticOrderRequest(page, "looking up public orders");
  expect(await readVisualSessionCounter(page, "visual-test:create-payment-intent-count")).toBe(0);
});

for (const stripeMode of stripeThreeDSModes) {
  test(`3DS return and public tracking preserve the no-charge notice for ${stripeMode.label}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((mode) => {
      if (window.sessionStorage.getItem("visual-test:3ds-mode")) return;

      window.sessionStorage.setItem("visual-test:3ds-mode", mode);
      window.sessionStorage.setItem("visual-test:3ds-order-lookup-count", "0");
      window.sessionStorage.setItem("visual-test:create-payment-intent-count", "0");
      window.localStorage.setItem(
        "pending_order_lookup",
        JSON.stringify({
          version: 1,
          entries: [
            {
              orderNumber: "VIS-3DS-001",
              token: "visual-3ds-payment-token",
              storeSlug: "visual-fixture",
              paymentIntentId: "pi_visual_3ds",
            },
          ],
        }),
      );
    }, stripeMode.mode);

    await page.goto(
      `/visual-tests/index.html?scenario=checkout&payment_intent=${recoveredPaymentIntentId}&payment_intent_client_secret=cs_visual_3ds_secret&redirect_status=succeeded`,
    );
    await expect(page.getByRole("heading", { name: "Pedido Confirmado!" })).toBeVisible();
    await expect(page.getByText(recoveredOrderNumber, { exact: true })).toBeVisible();
    await assertStripeNoChargeNotice(page, stripeMode.showsNoChargeNotice);
    await expect.poll(() => readVisualSessionCounter(page, "visual-test:3ds-order-lookup-count"))
      .toBeGreaterThan(0);
    const lookupCountAfterRecovery = await readVisualSessionCounter(
      page,
      "visual-test:3ds-order-lookup-count",
    );
    await assertNoSyntheticOrderRequest(page, "recovering a 3DS return");
    expect(await readVisualSessionCounter(page, "visual-test:create-payment-intent-count")).toBe(0);

    const checkoutUrl = new URL(page.url());
    expect(checkoutUrl.searchParams.has("payment_intent")).toBe(false);
    expect(checkoutUrl.searchParams.has("payment_intent_client_secret")).toBe(false);
    expect(checkoutUrl.searchParams.has("redirect_status")).toBe(false);

    await page.goto("/visual-tests/index.html?scenario=pedido");
    await expect(page.getByRole("heading", { name: "Consultar Pedido" })).toBeVisible();
    await expect(page.getByLabel("Número do Pedido")).toHaveValue(recoveredOrderNumber);
    await expect(page.getByLabel("Código de Acesso")).toHaveValue(recoveredOrderToken);
    await expect(page.getByText(recoveredOrderNumber, { exact: true })).toBeVisible();
    await assertStripeNoChargeNotice(page, stripeMode.showsNoChargeNotice);
    await expect.poll(() => readVisualSessionCounter(page, "visual-test:3ds-order-lookup-count"))
      .toBeGreaterThan(lookupCountAfterRecovery);
    await assertNoSyntheticOrderRequest(page, "looking up the recovered order on public tracking");
    expect(await readVisualSessionCounter(page, "visual-test:create-payment-intent-count")).toBe(0);
  });
}