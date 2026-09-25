import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) =>
    asChild ? createElement("span", props, children) : createElement("button", props, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => createElement("input", props),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => createElement("label", props, children),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => createElement("div", props, children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) => createElement("div", props, children),
  CardContent: ({ children, ...props }: any) => createElement("div", props, children),
  CardHeader: ({ children, ...props }: any) => createElement("div", props, children),
  CardTitle: ({ children, ...props }: any) => createElement("div", props, children),
  CardDescription: ({ children, ...props }: any) => createElement("div", props, children),
}));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children, ...props }: any) => createElement("table", props, children),
  TableBody: ({ children, ...props }: any) => createElement("tbody", props, children),
  TableCell: ({ children, ...props }: any) => createElement("td", props, children),
  TableHead: ({ children, ...props }: any) => createElement("th", props, children),
  TableHeader: ({ children, ...props }: any) => createElement("thead", props, children),
  TableRow: ({ children, ...props }: any) => createElement("tr", props, children),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) =>
    createElement("input", {
      ...props,
      type: "checkbox",
      checked: Boolean(checked),
      onChange: (event: any) => onCheckedChange?.(event.target.checked),
    }),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) =>
    createElement("input", {
      ...props,
      type: "checkbox",
      checked: Boolean(checked),
      onChange: (event: any) => onCheckedChange?.(event.target.checked),
    }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    createElement("div", { "data-select-value": value }, [
      createElement(
        "select",
        {
          key: "control",
          value,
          onChange: (event: any) => onValueChange?.(event.target.value),
          "aria-label": "select",
        },
        [
          createElement("option", { key: "all", value: "all" }, "all"),
          createElement("option", { key: "notified", value: "notified" }, "notified"),
          createElement("option", { key: "not_notified", value: "not_notified" }, "not_notified"),
          createElement("option", { key: "custom", value: "custom" }, "custom"),
        ],
      ),
      children,
    ]),
  SelectContent: ({ children, ...props }: any) => createElement("div", props, children),
  SelectItem: ({ children, value }: any) => createElement("option", { value }, children),
  SelectTrigger: ({ children, ...props }: any) => createElement("button", props, children),
  SelectValue: ({ children }: any) => createElement("span", null, children),
}));
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<((value: string) => void) | null>(null);
  return {
    Tabs: ({ children, onValueChange }: any) =>
      React.createElement(TabsContext.Provider, { value: onValueChange }, children),
    TabsList: ({ children, ...props }: any) => React.createElement("div", props, children),
    TabsContent: ({ children }: any) => React.createElement("div", null, children),
    TabsTrigger: ({ children, value, onClick }: any) => {
      const onValueChange = React.useContext(TabsContext);
      return React.createElement(
        "button",
        {
          type: "button",
          "data-tab": value,
          onClick: () => {
            onClick?.();
            onValueChange?.(value);
          },
        },
        children,
      );
    },
  };
});
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? createElement("div", { role: "dialog" }, children) : null),
  DialogContent: ({ children, ...props }: any) => createElement("div", props, children),
  DialogHeader: ({ children, ...props }: any) => createElement("div", props, children),
  DialogFooter: ({ children, ...props }: any) => createElement("div", props, children),
  DialogTitle: ({ children }: any) => createElement("h2", null, children),
  DialogDescription: ({ children }: any) => createElement("p", null, children),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuContent: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuItem: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuTrigger: ({ children, ...props }: any) => createElement("div", props, children),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children),
}));
vi.mock("lucide-react", async (importOriginal) => importOriginal());
vi.mock("@/lib/utils", () => ({
  formatCurrencyBRL: (value: unknown) => `R$ ${String(value)}`,
  formatDate: (value: unknown) => String(value),
  formatDateTime: (value: unknown) => String(value),
}));

import { ReferralTableSection, type ReferralTableRow } from "../components/referral-table-section.js";
import { ReferralSettingsDialog } from "../components/referral-settings-dialog.js";
import { ReferralCampaignsDialog, type CampaignDraft } from "../components/referral-campaigns-dialog.js";
import { ReferralOperationalDialogs } from "../components/referral-operational-dialogs.js";
import { ReferralDetailDialog } from "../components/referral-detail-dialog.js";
import { ReferralShareDialog } from "../components/referral-share-dialog.js";

const referral = {
  id: "referral-1",
  code: "CARIRI10",
  referrerId: "client-1",
  referrerName: "Maria",
  referrerEmail: "maria@example.com",
  referrerPhone: null,
  referrerWhatsapp: "88999999999",
  referredName: "João",
  referredEmail: "joao@example.com",
  status: "completed",
  isActive: true,
  bonusPaid: false,
  bonusAmount: "25",
  bonusPaidAt: null,
  bonusReleasesAt: null,
  bonusBlocked: false,
  discountApplied: false,
  discountAmount: "0",
  discountValue: "10",
  visitsCount: 3,
  lastVisit: "2026-09-18T12:00:00.000Z",
  expiresAt: "2026-10-18T12:00:00.000Z",
  createdAt: "2026-09-01T12:00:00.000Z",
  convertedAt: "2026-09-10T12:00:00.000Z",
  fraudFlag: false,
  fraudReason: null,
  reversalReason: null,
  reversalAt: null,
  linkedOrder: null,
  linkedReservations: [],
  linkedDeals: [],
} as unknown as ReferralTableRow;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const tableProps = () => ({
  referrals: [referral],
  settingsTiers: undefined,
  currentUserRole: "agencia",
  activeTab: "completed-unpaid",
  searchQuery: "",
  bonusNotifiedFilter: "all" as const,
  onBonusNotifiedFilterChange: vi.fn(),
  referralsLoading: false,
  referralsFetching: false,
  referralsError: false,
  referralTotal: 1,
  referralPageCount: 3,
  referralsPage: 1,
  expiringSoonCount: 0,
  pendingBonusCount: 1,
  suspiciousCount: 0,
  bonusNotifiedCount: 1,
  bonusNotNotifiedCount: 0,
  selectedBonusIds: new Set<string>(),
  onSearchChange: vi.fn(),
  onApplyTab: vi.fn(),
  onSelectedBonusIdsChange: vi.fn(),
  onPageChange: vi.fn(),
  onOpenDetail: vi.fn(),
  onOpenShare: vi.fn(),
  onOpenPayBonus: vi.fn(),
  onOpenReverseBonus: vi.fn(),
  onDeactivate: vi.fn(),
  onBulkPay: vi.fn(),
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("indicações após a refatoração", () => {
  it("mantém busca, aba, filtro de notificação, seleção, paginação e ações server-side", async () => {
    const props = tableProps();
    const { container } = await renderComponent(createElement(ReferralTableSection, props));

    const search = container.querySelector("#referral-search") as HTMLInputElement;
    expect(search).not.toBeNull();
    await flushAct(() => {
      setInputValue(search, "Maria");
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("Maria");

    await flushAct(() => {
      container.querySelector('button[data-tab="completed"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onApplyTab).toHaveBeenCalledWith("completed");

    const notificationSelect = container.querySelector('select[aria-label="select"]') as HTMLSelectElement;
    await flushAct(() => {
      notificationSelect.value = "notified";
      notificationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(props.onBonusNotifiedFilterChange).toHaveBeenCalledWith("notified");

    const rowCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await flushAct(() => {
      rowCheckbox.click();
    });
    expect(props.onSelectedBonusIdsChange).toHaveBeenCalledWith(new Set(["referral-1"]));

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Próxima"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onPageChange).toHaveBeenCalledWith(2);

    expect(container.querySelector('button[aria-label="Ver detalhes da indicação CARIRI10"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Compartilhar indicação CARIRI10"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Pagar bônus da indicação CARIRI10"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Reverter bônus da indicação CARIRI10"]')).not.toBeNull();
  });

  it("permite editar configurações, cancelar e salvar o dialog", async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const setDraft = vi.fn();
    const { container } = await renderComponent(createElement(ReferralSettingsDialog, {
      open: true,
      onOpenChange,
      draft: { isEnabled: true, discountValue: "5.00", bonusValue: "10.00" },
      setDraft,
      defaultTiers: [{ level: "bronze", label: "Bronze", minReferrals: 0, bonusMultiplier: 1 }],
      settingsBonusValue: 10,
      tenantName: "Agência Cariri",
      whatsappTestPhone: "",
      setWhatsappTestPhone: vi.fn(),
      whatsappTestState: {},
      settingsWhatsappTestLoading: false,
      updatePending: false,
      onSave,
      sendWhatsAppTest: vi.fn(),
      testWhatsappTemplate: vi.fn(),
    }));

    expect(container.textContent).toContain("Configurações do Programa de Indicações");
    const valueInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "5.00",
    ) as HTMLInputElement;
    await flushAct(() => {
      setInputValue(valueInput, "7.50");
    });
    expect(setDraft).toHaveBeenCalled();

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Salvar")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Cancelar")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("abre o formulário de campanha, preserva edição e executa exclusão", async () => {
    const onDelete = vi.fn();
    const campaign = {
      id: "campaign-1",
      name: "Bônus em dobro",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
      bonusType: "multiplier",
      bonusValue: "2",
      publicRanking: true,
      referralsCount: 1,
      bonusPaidAmount: "20",
      commissionType: "none",
    } as any;
    function Harness() {
      const [showForm, setShowForm] = useState(false);
      const [draft, setDraft] = useState<CampaignDraft>({
        name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2",
        bannerText: "", eligibleStoreProductIds: "", eligibleTierLevels: [], conversionCap: "",
        budgetAmount: "", shareMessage: "", materialUrl: "", publicRanking: true,
        eligibleActivitySegments: [], eligibleChannels: "", commissionType: "none",
        commissionValue: "0", commissionRecipientType: "ambassador", eligiblePartnerIds: "",
      });
      return createElement(ReferralCampaignsDialog, {
        open: true,
        onOpenChange: vi.fn(),
        campaigns: [campaign],
        activeCampaign: undefined,
        showForm,
        setShowForm,
        draft,
        setDraft,
        editingId: null,
        onEditingIdChange: vi.fn(),
        onSave: vi.fn(),
        onEdit: vi.fn(),
        onDelete,
        deletePending: false,
      });
    }
    const { container } = await renderComponent(createElement(Harness));

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Nova campanha"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Nova campanha");
    expect(container.querySelector('input[placeholder*="Bônus Duplo"]')).not.toBeNull();

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Bônus em dobro") === false && button.className.includes("text-red"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledWith("campaign-1");
  });

  it("mantém as ações dos dialogs operacionais, de detalhes e compartilhamento", async () => {
    const onPay = vi.fn();
    const onReverse = vi.fn();
    const onBulk = vi.fn();
    const onCopyLink = vi.fn();
    const onClose = vi.fn();
    const { container, rerender } = await renderComponent(createElement("div"));

    await rerender(createElement(ReferralOperationalDialogs, {
      bulkOpen: true, onBulkOpenChange: vi.fn(), selectedCount: 2, selectedTotal: 50,
      bulkPaying: false, onConfirmBulk: onBulk, payOpen: true, onPayOpenChange: vi.fn(),
      payTarget: referral, payPending: false, onConfirmPay: onPay, reverseOpen: true,
      onReverseOpenChange: vi.fn(), reverseTarget: referral, reverseReason: "cancelamento",
      onReverseReasonChange: vi.fn(), reversePending: false, onConfirmReverse: onReverse,
    }));
    await flushAct(() => {
      Array.from(container.querySelectorAll("button")).forEach((button) => {
        if (button.textContent?.includes("Confirmar")) button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    });
    expect(onBulk).toHaveBeenCalled();
    expect(onPay).toHaveBeenCalled();
    expect(onReverse).toHaveBeenCalled();

    await rerender(createElement(ReferralDetailDialog, {
      open: true, onOpenChange: vi.fn(), referral, copiedLink: false,
      shareLink: "https://example.com/ind/CARIRI10", onCopyLink, onPay,
      onReverse, canReverse: true,
    }));
    expect(container.textContent).toContain("Detalhes da Indicação");
    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Pagar Bônus"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPay).toHaveBeenCalled();

    await rerender(createElement(ReferralShareDialog, {
      open: true, onOpenChange: vi.fn(), loading: false,
      data: { link: "https://example.com/ind/CARIRI10", qrCodeDataUrl: "data:image/png;base64,qr" },
      referral, shareMessage: "Use {link}", copiedLink: false, copiedMessage: false,
      canCopyImage: false, onCopyLink, onCopyMessage: vi.fn(), onCopyQr: vi.fn(),
      onWhatsappQr: vi.fn(), whatsappUrl: "https://wa.me/5588999999999",
      isValidWhatsapp: () => true, onClose,
    }));
    expect(container.textContent).toContain("Compartilhar indicação");
    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Copiar link"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Fechar"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCopyLink).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});