import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { ListLoadError, ListLoadErrorRow } from "../components/list-load-error.js";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

afterEach(async () => {
  await cleanupRoots();
});

describe("ListLoadError", () => {
  it("shows a load failure instead of an empty-state message and retries", async () => {
    const retry = vi.fn();
    const handle = await renderComponent(
      createElement(ListLoadError, {
        onRetry: retry,
        message: "Não foi possível carregar os clientes.",
      }),
    );

    expect(handle.container.textContent).toContain("Não foi possível carregar os clientes.");
    expect(handle.container.textContent).toContain("Tentar novamente");
    expect(handle.container.textContent).not.toContain("Nenhum cliente cadastrado");

    const button = handle.container.querySelector("button");
    expect(button).not.toBeNull();
    await flushAct(() => button!.click());

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders a valid table row for list pages", async () => {
    const handle = await renderComponent(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          createElement(ListLoadErrorRow, {
            colSpan: 7,
            onRetry: vi.fn(),
            message: "Não foi possível carregar os destinos.",
          }),
        ),
      ),
    );

    const cell = handle.container.querySelector("td");
    expect(cell?.getAttribute("colspan")).toBe("7");
    expect(cell?.textContent).toContain("Não foi possível carregar os destinos.");
  });
});