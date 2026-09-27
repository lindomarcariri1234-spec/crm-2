// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent, renderHook } from "../../__tests__/eventSourceHarness";
import { AsyncEmpty, AsyncError, useAsyncResource } from "./async-state";
import { profileQuery } from "./profile-query";

afterEach(cleanupRoots);

describe("profile resources", () => {
  it("shows a failure, retries the request and only shows empty after a successful empty result", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("Conexão interrompida"))
      .mockResolvedValueOnce({ data: [] });
    const hook = await renderHook(() => useAsyncResource(fetcher));
    expect(hook.result.current.error).toBe("Conexão interrompida");
    expect(hook.result.current.data).toBeNull();
    const view = await renderComponent(createElement(AsyncError, {
      error: hook.result.current.error!,
      retry: () => { void hook.result.current.reload(); },
    }));
    expect(view.container.textContent).toContain("Conexão interrompida");
    await act(async () => { view.container.querySelector("button")!.click(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.data).toEqual({ data: [] });
    await view.rerender(createElement(AsyncEmpty, null, "Nenhum resultado"));
    expect(view.container.textContent).toContain("Nenhum resultado");
  });

  it("keeps a successful page while a subsequent request fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ data: ["a"] }).mockRejectedValueOnce(new Error("offline"));
    const hook = await renderHook(() => useAsyncResource(fetcher));
    await act(async () => { await hook.result.current.reload(); });
    expect(hook.result.current.error).toBe("offline");
    expect(hook.result.current.data).toEqual({ data: ["a"] });
  });
});

describe("profile query navigation", () => {
  it("changes tabs while retaining filters, and removes the filter when all is selected", () => {
    expect(profileQuery("?tab=inicio&status=reversed", "tab", "indicacoes"))
      .toBe("?tab=indicacoes&status=reversed");
    expect(profileQuery("?tab=indicacoes&status=reversed", "status", null))
      .toBe("?tab=indicacoes");
    expect(profileQuery("?tab=indicacoes", "status", "pending"))
      .toBe("?tab=indicacoes&status=pending");
  });
});