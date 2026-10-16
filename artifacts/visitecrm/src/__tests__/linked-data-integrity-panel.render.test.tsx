import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { LinkedDataIntegrityPanel } from "../components/linked-data-integrity-panel.js";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LinkedDataIntegrityPanel", () => {
  it("shows scan totals, human-readable findings, and lets admins retry a failed history request", async () => {
    const scan = {
      repaired: [],
      issues: [{
        type: "deal-reservation",
        id: "deal-123",
        reason: "client_trip_or_value_mismatch",
      }],
      mode: "dry-run",
      generatedAt: "2026-10-11T14:00:00.000Z",
      checked: 24,
      repairedCount: 0,
      issueCount: 1,
      summary: { checked: {}, repaired: {}, issues: {} },
      categories: {},
    };
    const history = {
      items: [],
      pagination: { limit: 8, offset: 0, total: 0, hasMore: false },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(scan))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "Histórico indisponível" }),
      })
      .mockResolvedValueOnce(jsonResponse(history));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = await renderComponent(createElement(LinkedDataIntegrityPanel));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="text-linked-integrity-checked"]')?.textContent)
      .toBe("24");
    expect(container.querySelector('[data-testid="text-linked-integrity-issue-count"]')?.textContent)
      .toBe("1");
    expect(container.querySelector('[data-testid="issue-linked-integrity-deal-123"]')?.textContent)
      .toContain("Cliente, viagem ou valor divergente da reserva");
    expect(container.querySelector('[data-testid="status-linked-integrity-history-error"]')?.textContent)
      .toContain("Histórico indisponível");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="button-retry-linked-integrity-history"]',
      )!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[data-testid="status-linked-integrity-history-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="status-linked-integrity-history-empty"]')?.textContent)
      .toContain("Nenhuma sincronização");
  });
});
