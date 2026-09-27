import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";
import { ReferralTableSection } from "../components/referral-table-section.js";
import { ReferralDetailDialog } from "../components/referral-detail-dialog.js";
import type { ReferralTableRow } from "../components/referral-table-section.js";

afterEach(cleanupRoots);

const rows = [
  { id: "locked", code: "LOCKED", status: "completed", bonusPaid: false, bonusBlocked: true, bonusReleasesAt: "2026-12-25T12:00:00Z", bonusAmount: "25", referrerId: "a", isActive: true },
  { id: "ready", code: "READY", status: "completed", bonusPaid: false, bonusBlocked: false, bonusAmount: "40", referrerId: "b", isActive: true },
] as ReferralTableRow[];

function props(overrides: Record<string, unknown> = {}) {
  return {
    referrals: rows, activeTab: "completed-unpaid", searchQuery: "", bonusNotifiedFilter: "all" as const,
    onBonusNotifiedFilterChange: vi.fn(), referralsLoading: false, referralsFetching: false,
    referralsError: false, onRetry: vi.fn(), referralTotal: 102, referralPageCount: 2, referralsPage: 1,
    expiringSoonCount: null, pendingBonusCount: null, suspiciousCount: null,
    bonusNotifiedCount: null, bonusNotNotifiedCount: null,
    selectedBonusIds: new Set<string>(), onSearchChange: vi.fn(), onApplyTab: vi.fn(),
    onSelectedBonusIdsChange: vi.fn(), onPageChange: vi.fn(), onOpenDetail: vi.fn(),
    onOpenShare: vi.fn(), onOpenPayBonus: vi.fn(), onOpenReverseBonus: vi.fn(),
    onDeactivate: vi.fn(), onBulkPay: vi.fn(), canPay: true, canReverse: true, canDeactivate: true, canShare: true,
    ...overrides,
  };
}

describe("tabela de indicações", () => {
  it("não oferece bônus bloqueado para seleção, pagamento ou seleção em lote", async () => {
    const callbacks = props();
    const { container } = await renderComponent(createElement(ReferralTableSection, callbacks));
    const locked = container.querySelector('[aria-label="Selecionar indicação LOCKED"]') as HTMLButtonElement;
    const ready = container.querySelector('[aria-label="Selecionar indicação READY"]') as HTMLButtonElement;
    expect(locked?.disabled).toBe(true);
    expect(ready?.disabled).toBe(false);
    expect(container.textContent).toContain("Bônus bloqueado");
    expect(container.textContent).toContain("25/12/2026");
    expect((container.querySelector('[aria-label="Pagar bônus da indicação LOCKED"]') as HTMLButtonElement)?.disabled).toBe(true);
    expect(container.textContent).toContain("102 no total");
    expect(container.textContent).toContain("Página 1 de 2");
    expect((container.querySelector("button[aria-label^='Selecionar todas']") as HTMLButtonElement)?.disabled).toBe(false);
    await flushAct(() => {
      (container.querySelector("button[aria-label^='Selecionar todas']") as HTMLButtonElement)?.click();
    });
    expect(callbacks.onSelectedBonusIdsChange).toHaveBeenCalledWith(new Set(["ready"]));
  });

  it("oculta pagamentos e reversões sem permissões e oferece retry após falha", async () => {
    const viewOnly = props({ canPay: false, canReverse: false, canDeactivate: false });
    const view = await renderComponent(createElement(ReferralTableSection, viewOnly));
    expect(view.container.querySelector('[aria-label="Pagar bônus da indicação READY"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Reverter bônus da indicação READY"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Selecionar indicação READY"]')).toBeNull();
    await cleanupRoots();
    const callbacks = props({ canPay: false, canReverse: false, canDeactivate: false, referralsError: true, referrals: [] });
    const { container } = await renderComponent(createElement(ReferralTableSection, callbacks));
    expect(container.getAttribute("role")).not.toBe("alert");
    expect(container.textContent).toContain("Não foi possível carregar as indicações");
    expect(container.textContent).not.toContain("Nenhuma indicação encontrada");
    expect(container.textContent).not.toContain("Página 1 de 2");
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Tentar novamente");
    retry?.click();
    expect(callbacks.onRetry).toHaveBeenCalled();
  });

  it("mostra data de liberação no detalhe e desabilita pagamento bloqueado", async () => {
    const onPay = vi.fn();
    await renderComponent(createElement(ReferralDetailDialog, {
      open: true, onOpenChange: vi.fn(), referral: rows[0], copiedLink: false,
      onCopyLink: vi.fn(), onPay, onReverse: vi.fn(), canPay: true, canReverse: false,
    }));
    expect(document.body.textContent).toContain("25/12/2026");
    const pay = Array.from(document.body.querySelectorAll("button")).find(button => button.textContent?.includes("Pagar Bônus"));
    expect(pay?.disabled).toBe(true);
    expect(onPay).not.toHaveBeenCalled();
  });
});