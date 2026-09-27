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

async function openFixture(page: Page, scenario: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/visual-tests/index.html?scenario=${scenario}`);
  await expect(page.locator("#visual-test-root")).toBeVisible();
  await expect(page.locator("#visual-test-root")).not.toContainText("Cenário de teste desconhecido.");
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