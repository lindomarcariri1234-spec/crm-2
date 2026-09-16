import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { AccommodationHelp } from "../components/accommodation-help.js";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

afterEach(async () => {
  await cleanupRoots();
});

describe("AccommodationHelp", () => {
  it("renders the functional guidance blocks and keeps the orientation expandable", async () => {
    const handle = await renderComponent(createElement(AccommodationHelp));

    expect(handle.container.querySelector('[data-testid="panel-hospedagens-help"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-objective"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-fields"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-actions"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-workflow"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-linked"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="help-hospedagens-not-integrated"]')).not.toBeNull();
    expect(handle.container.querySelector("details[open]")).not.toBeNull();

    const text = handle.container.textContent ?? "";
    expect(text).toContain("base organizada de hotéis, pousadas e outras acomodações parceiras");
    expect(text).toContain("não cria uma reserva");
    expect(text).toContain("Pesquisar");
    expect(text).toContain("Tentar novamente");
    expect(text).toContain("viagem, destino, fornecedor, reserva, produto da loja");
    expect(text).toContain("Custos de viagem e despesas são módulos separados");
  });
});