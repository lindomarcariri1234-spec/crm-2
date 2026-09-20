import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mocks = vi.hoisted(() => ({
  useListReferrals: vi.fn(),
  useGetReferralStats: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
  useQuery: vi.fn(),
  mutation: { mutateAsync: vi.fn(), isPending: false },
  updateSettings: { mutateAsync: vi.fn(), isPending: false },
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListReferrals: mocks.useListReferrals,
  useGetReferralStats: mocks.useGetReferralStats,
  useGetCurrentSubscription: () => ({ data: { plan: { name: "Pro", supportedFeatures: ["referrals"] } } }),
  useGetReferralCommissionReport: () => ({ data: undefined }),
  useGetReferralSettings: () => ({ data: undefined, refetch: vi.fn() }),
  useUpdateReferralSettings: () => mocks.updateSettings,
  usePayReferralBonus: () => mocks.mutation,
  useResendExpiryWarning: () => mocks.mutation,
  useResendBonusRelease: () => mocks.mutation,
  useReverseReferralBonus: () => mocks.mutation,
  useReversePaidReferralBonus: () => mocks.mutation,
  useUpdateReferral: () => mocks.mutation,
  useGetReferralAnalytics: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetReferralShare: () => ({ data: undefined, isLoading: false }),
  useGetReferralExpiryEmailStatus: () => ({ data: undefined, refetch: vi.fn() }),
  useGetReferralBonusReleaseEmailStatus: () => ({ data: undefined, refetch: vi.fn() }),
  useGetMe: () => ({ data: { role: "agencia", tenant: { name: "Agência Cariri" } } }),
  useListReferralCampaigns: () => ({ data: [], refetch: vi.fn() }),
  useCreateReferralCampaign: () => mocks.mutation,
  useDeleteReferralCampaign: () => mocks.mutation,
  useUpdateReferralCampaign: () => mocks.mutation,
  testWhatsAppMessage: vi.fn(),
  getReferralExportUrl: () => "/api/referrals/export",
  getReferralAnalyticsExportUrl: () => "/api/referrals/analytics/export",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
  useQuery: mocks.useQuery,
}));

vi.mock("@workspace/permissions", () => ({
  ROLES: {
    SUPER_ADMIN: "superadmin",
    AGENCY_ADMIN: "agencia",
    AGENCY_MANAGER: "gerente",
    SALES: "vendedor",
    SUPPORT: "suporte",
  },
  REFERRAL_STATUS: {
    PENDING: "pending",
    COMPLETED: "completed",
    CONVERTED: "converted",
    EXPIRED: "expired",
    REVERSED: "reversed",
  },
}));

vi.mock("@workspace/shared", () => ({ localToday: () => "2026-09-19" }));
vi.mock("@/lib/referral-labels", () => ({
  getReferralCampaignRewardLabel: () => "Campanha",
  getReferralRewardLabel: () => "Cashback",
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => createElement("a", props, children),
}));
vi.mock("@/components/plan-limit-wall", () => ({
  PlanFeatureWall: () => null,
  canUpgradeForFeature: () => false,
  getRequiredPlanLabel: () => "Pro",
}));

vi.mock("@/components/referral-overview", () => ({ ReferralOverview: () => null }));
vi.mock("@/components/referral-commission-summary", () => ({ ReferralCommissionSummary: () => null }));
vi.mock("@/components/referral-analytics-section", () => ({ ReferralAnalyticsSection: () => null }));
vi.mock("@/components/referral-table-section", () => ({
  ReferralTableSection: (props: any) => createElement("section", null, [
    createElement("input", {
      key: "search",
      "data-testid": "referral-search",
      value: props.searchQuery,
      onChange: (event: any) => props.onSearchChange(event.target.value),
    }),
    createElement("button", {
      key: "tab",
      "data-testid": "referral-tab-unpaid",
      onClick: () => props.onApplyTab("completed-unpaid"),
    }, "Bônus pendente"),
    createElement("button", {
      key: "notification",
      "data-testid": "referral-filter-notified",
      onClick: () => props.onBonusNotifiedFilterChange("notified"),
    }, "Notificados"),
    createElement("button", {
      key: "select",
      "data-testid": "referral-select-one",
      onClick: () => props.onSelectedBonusIdsChange(new Set(["referral-1"])),
    }, "Selecionar"),
    createElement("button", {
      key: "page",
      "data-testid": "referral-page-two",
      onClick: () => props.onPageChange(2),
    }, "Página 2"),
    createElement("span", { key: "state", "data-testid": "referral-state" },
      `${props.activeTab}|${props.referralsPage}|${props.selectedBonusIds.size}`),
  ]),
}));
vi.mock("@/components/referral-settings-dialog", () => ({
  ReferralSettingsDialog: ({ open, onOpenChange, onSave }: any) => open
    ? createElement("div", { "data-testid": "settings-dialog" }, [
      createElement("button", { key: "close", onClick: () => onOpenChange(false) }, "Fechar configurações"),
      createElement("button", { key: "save", onClick: onSave }, "Salvar configurações"),
    ])
    : null,
}));
vi.mock("@/components/referral-campaigns-dialog", () => ({
  ReferralCampaignsDialog: ({ open, onOpenChange }: any) => open
    ? createElement("div", { "data-testid": "campaigns-dialog" },
      createElement("button", { onClick: () => onOpenChange(false) }, "Fechar campanhas"))
    : null,
}));
vi.mock("@/components/referral-operational-dialogs", () => ({ ReferralOperationalDialogs: () => null }));
vi.mock("@/components/referral-share-dialog", () => ({ ReferralShareDialog: () => null }));
vi.mock("@/components/referral-detail-dialog", () => ({ ReferralDetailDialog: () => null }));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: any) =>
    asChild ? createElement("span", props, children) : createElement("button", props, children),
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
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => createElement("input", props) }));
vi.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: any) => createElement("label", props, children) }));
vi.mock("@/components/ui/switch", () => ({ Switch: (props: any) => createElement("input", { ...props, type: "checkbox" }) }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: (props: any) => createElement("input", { ...props, type: "checkbox" }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? createElement("div", null, children) : null,
  DialogContent: ({ children, ...props }: any) => createElement("div", props, children),
  DialogHeader: ({ children, ...props }: any) => createElement("div", props, children),
  DialogFooter: ({ children, ...props }: any) => createElement("div", props, children),
  DialogTitle: ({ children }: any) => createElement("h2", null, children),
  DialogDescription: ({ children }: any) => createElement("p", null, children),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, ...props }: any) => createElement("div", props, children),
  TabsList: ({ children, ...props }: any) => createElement("div", props, children),
  TabsContent: ({ children, ...props }: any) => createElement("div", props, children),
  TabsTrigger: ({ children, ...props }: any) => createElement("button", props, children),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, ...props }: any) => createElement("div", props, children),
  SelectContent: ({ children, ...props }: any) => createElement("div", props, children),
  SelectItem: ({ children, ...props }: any) => createElement("div", props, children),
  SelectTrigger: ({ children, ...props }: any) => createElement("button", props, children),
  SelectValue: ({ children, ...props }: any) => createElement("span", props, children),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuContent: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuItem: ({ children, ...props }: any) => createElement("div", props, children),
  DropdownMenuTrigger: ({ children, ...props }: any) => createElement("div", props, children),
}));

vi.mock("lucide-react", async (importOriginal) => importOriginal());
vi.mock("@/lib/utils", () => ({
  formatCurrencyBRL: (value: unknown) => String(value),
  formatDate: (value: unknown) => String(value),
  formatDateTime: (value: unknown) => String(value),
}));

import Indicacoes from "../pages/indicacoes.js";

const referralResponse = {
  data: [{
    id: "referral-1",
    code: "CARIRI10",
    referrerId: "client-1",
    referrerName: "Maria",
    status: "completed",
    bonusPaid: false,
    bonusAmount: "25",
    isActive: true,
  }],
  pagination: { page: 1, limit: 100, total: 3, totalPages: 3 },
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  mocks.useListReferrals.mockReset();
  mocks.useGetReferralStats.mockReset();
  mocks.useQuery.mockReset();
  mocks.queryClient.invalidateQueries.mockReset();
  mocks.useListReferrals.mockReturnValue({
    data: referralResponse, isLoading: false, isFetching: false, isError: false,
  });
  mocks.useGetReferralStats.mockReturnValue({
    data: { suspicious: 0, expiringSoon: 0, pendingBonus: 1 }, isLoading: false, isError: false,
  });
  mocks.useQuery.mockReturnValue({ data: undefined });
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("orquestração da página de indicações", () => {
  it("envia filtros server-side e reinicia página e seleção ao trocar filtros", async () => {
    const { container } = await renderComponent(createElement(Indicacoes));
    const search = container.querySelector('[data-testid="referral-search"]') as HTMLInputElement;

    await flushAct(() => {
      setInputValue(search, "Maria");
    });
    expect(mocks.useListReferrals).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      search: "Maria",
    }));

    await flushAct(() => {
      container.querySelector('[data-testid="referral-page-two"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.useListReferrals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await flushAct(() => {
      container.querySelector('[data-testid="referral-select-one"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="referral-filter-notified"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.useListReferrals).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      bonusNotified: true,
    }));
    expect(container.querySelector('[data-testid="referral-state"]')?.textContent).toContain("|1|0");

    await flushAct(() => {
      container.querySelector('[data-testid="referral-tab-unpaid"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.useListReferrals).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      status: "completed",
      bonusPaid: false,
    }));
    expect(container.querySelector('[data-testid="referral-state"]')?.textContent).toContain("completed-unpaid|1|0");
  });

  it("abre e fecha configurações e campanhas pelos controles da página", async () => {
    const { container } = await renderComponent(createElement(Indicacoes));

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Configurações"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="settings-dialog"]')).not.toBeNull();

    await flushAct(() => {
      container.querySelector('[data-testid="settings-dialog"] button')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="settings-dialog"]')).toBeNull();

    await flushAct(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Campanhas"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="campaigns-dialog"]')).not.toBeNull();
  });
});