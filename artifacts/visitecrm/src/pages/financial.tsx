import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { localToday } from "@workspace/shared";
import {
  useGetPaymentsSummary,
  useListPayments,
  useListExpenses,
  useListCommissions,
  useListCommissionRules,
  useCreatePayment,
  useUpdatePayment,
  useCreateExpense,
  useUpdateExpense,
  useUpdateCommission,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
  useGetDashboardRevenueChart,
  useListClients,
} from "@workspace/api-client-react";
import type { CommissionRule } from "@workspace/api-client-react";
import { PAYMENT_STATUS, PAYMENT_TYPE, EXPENSE_STATUS, COMMISSION_STATUS } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useSearch, useLocation } from "wouter";
import {
  Plus, TrendingUp, TrendingDown, DollarSign, AlertCircle, CheckCircle,
  Pencil, Trash2, ArrowUpRight, ArrowDownRight, BarChart2, ExternalLink,
  Paperclip, X as XIcon, FileText, Image,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PAYMENT_STATUS_LABELS as STATUS_LABELS, PAYMENT_STATUS_COLORS as STATUS_COLORS, PAYMENT_METHOD_LABELS as METHOD_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { FinancialMetricsOverview } from "@/components/financial-metrics-overview";
import { useFinancialMetrics } from "@/lib/financial-metrics-api";

const fmt = (v: number | string) => formatCurrency(typeof v === "string" ? parseFloat(v) || 0 : v);
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EXPENSE_CATEGORIES: Record<string, string> = EXPENSE_CATEGORY_LABELS;

function KpiCard({ icon: Icon, label, value, sub, trend, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; trend?: "up" | "down" | "neutral"; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`mt-1 p-2 rounded-md bg-muted ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        {trend && (
          <div className={trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}>
            {trend === "up" ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RevenueChart({ data }: { data: Array<{ label: string; revenue: number; expenses: number }> }) {
  const max = Math.max(...data.map(d => Math.max(d.revenue, d.expenses)), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {data.map((point, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex flex-col gap-0.5 justify-end" style={{ height: "128px" }}>
              <div
                className="w-full bg-primary/80 rounded-t-sm min-h-[2px]"
                style={{ height: `${Math.max((point.revenue / max) * 120, 2)}px` }}
                title={`Receita: ${fmt(point.revenue)}`}
              />
              <div
                className="w-full bg-destructive/60 rounded-t-sm min-h-[2px]"
                style={{ height: `${Math.max((point.expenses / max) * 120, 2)}px` }}
                title={`Despesas: ${fmt(point.expenses)}`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{point.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary/80 inline-block" /> Receita</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-destructive/60 inline-block" /> Despesas</span>
      </div>
    </div>
  );
}

function PaymentMethodChart({ payments }: { payments: Array<{ paymentMethod?: string; amount: number | string }> }) {
  const methodTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      if (!p.paymentMethod) continue;
      map[p.paymentMethod] = (map[p.paymentMethod] ?? 0) + parseFloat(String(p.amount));
    }
    return map;
  }, [payments]);

  const total = Object.values(methodTotals).reduce((a, b) => a + b, 0) || 1;
  const colorMap: Record<string, string> = {
    pix: "bg-green-500",
    credit_card: "bg-purple-500",
    debit_card: "bg-indigo-500",
    bank_transfer: "bg-blue-500",
    cash: "bg-orange-500",
    boleto: "bg-red-500",
  };
  const entries = Object.entries(methodTotals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Nenhum pagamento registrado ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-28 shrink-0">{METHOD_LABELS[key] ?? key}</span>
          <div className="flex-1 bg-muted rounded-full h-2">
            <div className={`${colorMap[key] ?? "bg-gray-500"} h-2 rounded-full`} style={{ width: `${(value / total) * 100}%` }} />
          </div>
          <span className="text-xs font-medium w-14 text-right">{((value / total) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

const VALID_TABS = ["receivable", "payable", "expenses", "commissions", "settlement", "rules"];

type SettlementData = {
  summary: {
    agencyNet: number;
    partnerPayable: number;
    walletOutstanding: number;
    cashbackOutstanding: number;
    reversals: number;
  };
  entries: Array<{
    id: string;
    participantType: string;
    category: string;
    direction: string;
    amount: number;
    settlementStatus: string;
    eventType: string;
    occurredAt: string;
  }>;
};

export default function Financial() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(searchStr);
    const t = params.get("tab");
    return VALID_TABS.includes(t ?? "") ? t! : "receivable";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: runs once on mount to set the initial tab;
  // subsequent URL changes are handled by the useEffect below (searchStr dep) to avoid resetting user-selected tabs.
  }, []);
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const t = params.get("tab");
    if (t && VALID_TABS.includes(t)) {
      setTab(t);
    }
  }, [searchStr]);
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(searchStr).get("status") ?? "");
  const [categoryFilter, setCategoryFilter] = useState(() => new URLSearchParams(searchStr).get("category") ?? "");
  const [dateFrom, setDateFrom] = useState(() => new URLSearchParams(searchStr).get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(() => new URLSearchParams(searchStr).get("dateTo") ?? "");

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    navigate(`?${params.toString()}`, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, categoryFilter, dateFrom, dateTo]);
  const [showUpcomingInstallments, setShowUpcomingInstallments] = useState(false);
  const [upcomingInstallments, setUpcomingInstallments] = useState<Array<{
    id: string; reservationId: string; installmentNumber: number; dueDate: string;
    amount: number; clientName: string | null; tripName: string | null; voucherCode: string | null;
  }>>([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [settlement, setSettlement] = useState<SettlementData | null>(null);
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isRuleOpen, setIsRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [paymentType, setPaymentType] = useState("receivable");
  const [paymentCategory, setPaymentCategory] = useState("reservation");
  const [paymentMethodField, setPaymentMethodField] = useState("pix");
  const [expenseMethod, setExpenseMethod] = useState("pix");
  const [expenseCategory, setExpenseCategory] = useState("transport");
  const [ruleType, setRuleType] = useState("percentage");
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchUpcomingInstallments = useCallback(async () => {
    setLoadingUpcoming(true);
    try {
      const res = await fetch(`${BASE}/api/reservations/installments/upcoming?days=7`, { credentials: "include" });
      if (res.ok) setUpcomingInstallments(await res.json());
    } catch { /* ignore */ } finally { setLoadingUpcoming(false); }
  }, []);

  const fetchSettlement = useCallback(async () => {
    setLoadingSettlement(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await fetch(`${BASE}/api/financial/settlement${params.size ? `?${params}` : ""}`, {
        credentials: "include",
      });
      if (response.ok) setSettlement(await response.json() as SettlementData);
    } finally {
      setLoadingSettlement(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (tab === "settlement") void fetchSettlement();
  }, [tab, fetchSettlement]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReceiptDataUrl(ev.target?.result as string);
      setReceiptFileName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  const { refetch: refetchSummary } = useGetPaymentsSummary();
  const { data: paymentsData, isLoading: loadingPayments, refetch: refetchPayments } = useListPayments({
    type: tab === "receivable" || tab === "payable" ? tab : undefined,
    status: statusFilter || undefined,
    limit: 50,
  });
  const { data: allReceivedPayments } = useListPayments({ type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, limit: 500 });
  const { data: expensesData, isLoading: loadingExpenses, refetch: refetchExpenses } = useListExpenses({ limit: 50 });
  const { data: commissionsData, isLoading: loadingCommissions, refetch: refetchCommissions } = useListCommissions();
  const { data: rulesData, isLoading: loadingRules, refetch: refetchRules } = useListCommissionRules();
  const { data: chartData } = useGetDashboardRevenueChart({ period: "12m" });
  const { data: clientsData } = useListClients({ limit: 500, page: 1 });
  const { data: financialMetrics, isLoading: loadingFinancialMetrics } = useFinancialMetrics();

  const clientMap = useMemo(() => {
    const map: Record<string, string> = {};
    (clientsData?.data ?? []).forEach(c => { map[c.id] = c.name; });
    return map;
  }, [clientsData]);

  const canonicalTotals = financialMetrics?.totals;
  const canonicalRevenue = canonicalTotals?.receivedRevenue ?? 0;
  const canonicalCosts = canonicalTotals?.operatingCostsPaid ?? 0;

  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const updateCommission = useUpdateCommission();
  const createRule = useCreateCommissionRule();
  const updateRule = useUpdateCommissionRule();
  const deleteRule = useDeleteCommissionRule();

  const handleCreatePayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createPayment.mutateAsync({
      data: {
        type: paymentType,
        category: paymentCategory || "reservation",
        amount: parseFloat(fd.get("amount") as string || "0"),
        paymentMethod: paymentMethodField || "pix",
        dueDate: fd.get("dueDate") as string,
        description: fd.get("description") as string || undefined,
        installments: parseInt(fd.get("installments") as string || "1"),
        ...(receiptDataUrl ? { receiptUrl: receiptDataUrl } : {}),
      } as Parameters<typeof createPayment.mutateAsync>[0]["data"]
    });
    setIsPaymentOpen(false);
    setPaymentCategory("reservation");
    setPaymentMethodField("pix");
    setReceiptDataUrl(null);
    setReceiptFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    refetchPayments();
    refetchSummary();
  };

  const handleCreateExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createExpense.mutateAsync({
      data: {
        category: expenseCategory || "transport",
        description: fd.get("description") as string,
        amount: parseFloat(fd.get("amount") as string || "0"),
        dueDate: fd.get("dueDate") as string,
        paymentMethod: expenseMethod || undefined,
        notes: fd.get("notes") as string || undefined,
      }
    });
    setIsExpenseOpen(false);
    setExpenseCategory("transport");
    refetchExpenses();
  };

  const handleMarkPaid = async (paymentId: string) => {
    await updatePayment.mutateAsync({ id: paymentId, data: { status: PAYMENT_STATUS.PAID, paidAt: new Date().toISOString() } });
    refetchPayments();
    refetchSummary();
  };

  const handleMarkExpensePaid = async (expenseId: string) => {
    await updateExpense.mutateAsync({
      id: expenseId,
      data: { status: PAYMENT_STATUS.PAID, paymentDate: localToday() }
    });
    refetchExpenses();
  };

  const handleApproveCommission = async (id: string) => {
    await updateCommission.mutateAsync({ id, data: { status: COMMISSION_STATUS.APPROVED } });
    refetchCommissions();
  };

  const handlePayCommission = async (id: string) => {
    await updateCommission.mutateAsync({ id, data: { status: PAYMENT_STATUS.PAID, paidAt: new Date().toISOString() } });
    refetchCommissions();
  };

  const handleSaveRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ruleData = {
      name: fd.get("name") as string,
      type: ruleType as "percentage" | "fixed",
      value: fd.get("value") as string,
      appliesTo: fd.get("appliesTo") as string || "all",
      isActive: true,
    };
    if (editingRule) {
      await updateRule.mutateAsync({ id: editingRule.id, data: { ...ruleData } });
    } else {
      await createRule.mutateAsync({ data: ruleData });
    }
    setIsRuleOpen(false);
    setEditingRule(null);
    refetchRules();
  };

  const handleDeleteRule = async (id: string) => {
    await deleteRule.mutateAsync({ id });
    refetchRules();
  };

  const commissions = Array.isArray(commissionsData) ? commissionsData : [];
  const commissionKpis = useMemo(() => {
    const total = commissions.reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const paid = commissions.filter(c => c.status === COMMISSION_STATUS.PAID).reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const pending = commissions.filter(c => c.status === COMMISSION_STATUS.PENDING).reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    return { total, paid, pending };
  }, [commissions]);

  const filteredPayments = useMemo(() => {
    let all = paymentsData?.data ?? [];
    if (dateFrom) all = all.filter(p => p.dueDate >= dateFrom);
    if (dateTo) all = all.filter(p => p.dueDate <= dateTo);
    return all;
  }, [paymentsData, dateFrom, dateTo]);

  const filteredExpenses = useMemo(() => {
    let all = expensesData?.data ?? [];
    if (statusFilter) all = all.filter(e => e.status === statusFilter);
    if (categoryFilter) all = all.filter(e => e.category === categoryFilter);
    if (dateFrom) all = all.filter(e => e.dueDate >= dateFrom);
    if (dateTo) all = all.filter(e => e.dueDate <= dateTo);
    return all;
  }, [expensesData, statusFilter, categoryFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Controle receitas, despesas, comissões e fluxo de caixa"
        actions={
          <>
          <Link href="/financeiro/commissions">
            <Button variant="ghost" size="sm">
              <ExternalLink className="w-4 h-4 mr-1.5" /> Comissões
            </Button>
          </Link>
          <Link href="/financeiro/expenses">
            <Button variant="ghost" size="sm">
              <ExternalLink className="w-4 h-4 mr-1.5" /> Despesas
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsExpenseOpen(true)}>
            <TrendingDown className="w-4 h-4 mr-2" /> Nova Despesa
          </Button>
          <Button onClick={() => setIsPaymentOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Novo Lançamento
          </Button>
          </>
        }
      />

      <FinancialMetricsOverview />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Receita Recebida"
          value={loadingFinancialMetrics ? "—" : fmt(canonicalRevenue)}
          sub="Caixa recebido no mês atual (BRT)"
          color="text-green-600"
          trend="up"
        />
        <KpiCard
          icon={CheckCircle}
          label="Receita Contratada"
          value={loadingFinancialMetrics ? "—" : fmt(canonicalTotals?.bookedRevenue ?? 0)}
          sub={`Descontos: ${fmt(canonicalTotals?.discounts ?? 0)}`}
          color="text-blue-600"
        />
        <KpiCard
          icon={AlertCircle}
          label="A Receber"
          value={loadingFinancialMetrics ? "—" : fmt(canonicalTotals?.receivable ?? 0)}
          sub={`Vencido: ${fmt(canonicalTotals?.overdueReceivable ?? 0)}`}
          color="text-yellow-600"
          trend="down"
        />
        <KpiCard
          icon={TrendingDown}
          label="Custos Operacionais Pagos"
          value={loadingFinancialMetrics ? "—" : fmt(canonicalCosts)}
          sub={`A pagar: ${fmt(canonicalTotals?.payable ?? 0)}`}
          color="text-red-600"
        />
      </div>

      {(() => {
        const netProfit = canonicalTotals?.profit ?? 0;
        const margin = canonicalTotals?.margin ?? 0;
        const isProfit = netProfit >= 0;
        return (
          <Card className={`border-2 ${isProfit ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/20"}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Resultado Financeiro
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-5">
                <div className="md:col-span-2 flex flex-col items-center justify-center py-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Resultado Líquido</p>
                  <p className={`text-3xl font-bold ${isProfit ? "text-emerald-600" : "text-red-600"}`}>
                    {isProfit ? "+" : ""}{fmt(netProfit)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">Margem: {margin.toFixed(1)}%</p>
                </div>
                <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">Receita Recebida</p>
                    <p className="text-lg font-semibold text-green-600">{fmt(canonicalRevenue)}</p>
                    <p className="text-[10px] text-muted-foreground">Contratada: {fmt(canonicalTotals?.bookedRevenue ?? 0)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">Despesas Pagas</p>
                    <p className="text-lg font-semibold text-red-600">{fmt(canonicalCosts)}</p>
                    <p className="text-[10px] text-muted-foreground">A pagar: {fmt(canonicalTotals?.payable ?? 0)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">A Receber</p>
                    <p className="text-lg font-semibold text-blue-600">{fmt(canonicalTotals?.receivable ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Vencido: {fmt(canonicalTotals?.overdueReceivable ?? 0)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">A Pagar Pendente</p>
                    <p className="text-lg font-semibold text-orange-600">{fmt(canonicalTotals?.payable ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Vencido: {fmt(canonicalTotals?.overduePayable ?? 0)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">Dívidas com Usuários</p>
                    <p className="text-lg font-semibold">{fmt(canonicalTotals?.userDebt ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Saldos e comissões não pagas</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">Bônus e Créditos</p>
                    <p className="text-lg font-semibold text-violet-600">{fmt((canonicalTotals?.clientReferralBonuses ?? 0) + (canonicalTotals?.clientReferralCredits ?? 0))}</p>
                    <p className="text-[10px] text-muted-foreground">Benefícios de indicação no período</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {chartData && chartData.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Receita x Despesas (12 meses)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart data={chartData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Formas de Pagamento</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentMethodChart payments={allReceivedPayments?.data ?? []} />
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={tab} onValueChange={t => { setTab(t); setStatusFilter(""); setCategoryFilter(""); setDateFrom(""); setDateTo(""); }}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="receivable">A Receber</TabsTrigger>
              <TabsTrigger value="payable">A Pagar</TabsTrigger>
              <TabsTrigger value="expenses">Despesas</TabsTrigger>
              <TabsTrigger value="commissions">Comissões</TabsTrigger>
              <TabsTrigger value="settlement">Liquidação</TabsTrigger>
              <TabsTrigger value="rules">Regras</TabsTrigger>
            </TabsList>
          </div>
          {(tab === "receivable" || tab === "payable" || tab === "expenses") && (
            <div className="flex items-center gap-2 flex-wrap bg-card border rounded-lg p-3">
              <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value={EXPENSE_STATUS.PENDING}>Pendente</SelectItem>
                  <SelectItem value={EXPENSE_STATUS.PAID}>Pago</SelectItem>
                  <SelectItem value={EXPENSE_STATUS.OVERDUE}>Vencido</SelectItem>
                </SelectContent>
              </Select>
              {tab === "expenses" && (
                <Select value={categoryFilter || "all"} onValueChange={v => setCategoryFilter(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[150px] h-8 text-sm"><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    <SelectItem value="transport">Transporte</SelectItem>
                    <SelectItem value="accommodation">Hospedagem</SelectItem>
                    <SelectItem value="food">Alimentação</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="administrative">Administrativo</SelectItem>
                    <SelectItem value="commission">Comissão</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-1">
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-32 h-8 text-sm" />
                <span className="text-muted-foreground text-xs">até</span>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-32 h-8 text-sm" />
              </div>
              {tab === "receivable" && (
                <Button
                  variant={showUpcomingInstallments ? "default" : "outline"}
                  size="sm"
                  className={`h-8 text-xs ${showUpcomingInstallments ? "" : "border-orange-300 text-orange-700 hover:bg-orange-50"}`}
                  onClick={() => {
                    if (showUpcomingInstallments) {
                      setShowUpcomingInstallments(false);
                      setUpcomingInstallments([]);
                    } else {
                      setShowUpcomingInstallments(true);
                      fetchUpcomingInstallments();
                    }
                  }}
                >
                  📅 Vencimentos em 7 dias
                </Button>
              )}
              {(statusFilter || categoryFilter || dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setStatusFilter(""); setCategoryFilter(""); setDateFrom(""); setDateTo(""); }}>
                  Limpar
                </Button>
              )}
            </div>
          )}
        </div>

        <TabsContent value="receivable" className="mt-4 space-y-4">
          {showUpcomingInstallments && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-orange-100 border-b border-orange-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-orange-800">📅 Parcelas com vencimento nos próximos 7 dias</h3>
                <span className="text-xs text-orange-600">{upcomingInstallments.length} parcela(s)</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reserva</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Viagem</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingUpcoming ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                    ))
                  ) : upcomingInstallments.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-sm">Nenhuma parcela vencendo nos próximos 7 dias.</TableCell></TableRow>
                  ) : upcomingInstallments.map(inst => (
                    <TableRow key={inst.id} className="hover:bg-orange-50/50">
                      <TableCell className="font-mono text-xs">{inst.voucherCode ?? "—"}</TableCell>
                      <TableCell className="text-sm">{inst.clientName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">{inst.tripName ?? "—"}</TableCell>
                      <TableCell className="text-sm text-center">#{inst.installmentNumber}</TableCell>
                      <TableCell className="text-sm font-medium text-orange-700">{formatDate(String(inst.dueDate))}</TableCell>
                      <TableCell className="font-semibold text-sm">{fmt(inst.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/reservations?id=${inst.reservationId}`}>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                            <ExternalLink className="w-3 h-3 mr-1" /> Ver reserva
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayments ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : filteredPayments.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
                ) : filteredPayments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell><p className="font-medium text-sm">{p.description || "—"}</p></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.clientId ? (clientMap[p.clientId] ?? "—") : "—"}</TableCell>
                    <TableCell><span className="text-xs text-muted-foreground">{p.category}</span></TableCell>
                    <TableCell className="text-sm">{formatDate(String(p.dueDate))}</TableCell>
                    <TableCell className="font-medium text-sm">{fmt(p.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === PAYMENT_STATUS.PENDING && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkPaid(p.id)}>
                          <CheckCircle className="w-4 h-4 mr-1" /> Recebido
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="payable" className="mt-4">
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPayments ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : filteredPayments.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
                ) : filteredPayments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell><p className="font-medium text-sm">{p.description || "—"}</p></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.category}</TableCell>
                    <TableCell className="text-sm">{formatDate(String(p.dueDate))}</TableCell>
                    <TableCell className="font-medium text-sm">{fmt(p.amount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === PAYMENT_STATUS.PENDING && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkPaid(p.id)}>
                          <CheckCircle className="w-4 h-4 mr-1" /> Pago
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button variant="outline" size="sm" onClick={() => setIsExpenseOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Registrar Despesa
            </Button>
          </div>
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingExpenses ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : filteredExpenses.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma despesa registrada.</TableCell></TableRow>
                ) : filteredExpenses.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-sm">{e.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{EXPENSE_CATEGORIES[e.category] ?? e.category}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{(e as { supplierName?: string }).supplierName ?? (e.supplierId ? e.supplierId.slice(0, 8) + "…" : "—")}</TableCell>
                    <TableCell className="text-sm">{formatDate(String(e.dueDate))}</TableCell>
                    <TableCell className="font-medium text-sm">{fmt(e.amount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[e.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_LABELS[e.status] ?? e.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {e.status !== EXPENSE_STATUS.PAID && (
                        <Button size="sm" variant="outline" onClick={() => handleMarkExpensePaid(e.id)}>
                          <CheckCircle className="w-4 h-4 mr-1" /> Pago
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="commissions" className="mt-4 space-y-4">
          <div className="grid gap-4 grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Total de Comissões</p>
                <p className="text-2xl font-bold mt-1">{fmt(commissionKpis.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Pagas</p>
                <p className="text-2xl font-bold mt-1 text-green-600">{fmt(commissionKpis.paid)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Pendentes</p>
                <p className="text-2xl font-bold mt-1 text-yellow-600">{fmt(commissionKpis.pending)}</p>
              </CardContent>
            </Card>
          </div>
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCommissions ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : commissions.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma comissão registrada.</TableCell></TableRow>
                ) : commissions.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm">{c.userId}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.reservationId ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmt(c.baseAmount)}</TableCell>
                    <TableCell className="font-semibold text-sm">{fmt(c.commissionAmount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {c.status === COMMISSION_STATUS.PENDING && (
                          <Button size="sm" variant="outline" onClick={() => handleApproveCommission(c.id)}>
                            Aprovar
                          </Button>
                        )}
                        {c.status === COMMISSION_STATUS.APPROVED && (
                          <Button size="sm" onClick={() => handlePayCommission(c.id)}>
                            <DollarSign className="w-4 h-4 mr-1" /> Pagar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingRule(null); setIsRuleOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova Regra
            </Button>
          </div>
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Aplica a</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRules ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : !rulesData?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma regra de comissão cadastrada.</TableCell></TableRow>
                ) : rulesData.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-sm">{rule.name}</TableCell>
                    <TableCell className="text-sm">{rule.type === "percentage" ? "Percentual" : "Fixo"}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {rule.type === "percentage" ? `${rule.value}%` : fmt(rule.value)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rule.appliesTo}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {rule.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingRule(rule); setRuleType(rule.type); setIsRuleOpen(true); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteRule(rule.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="settlement" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Livro de liquidação por participante. Valores de carteira, cashback e comissão não se misturam.
            </p>
            <Button size="sm" variant="outline" onClick={() => void fetchSettlement()} disabled={loadingSettlement}>
              Atualizar
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard icon={DollarSign} label="Receita da agência" value={fmt(settlement?.summary.agencyNet ?? 0)} color="text-emerald-600" />
            <KpiCard icon={TrendingDown} label="Repasse a parceiros" value={fmt(settlement?.summary.partnerPayable ?? 0)} color="text-blue-600" />
            <KpiCard icon={DollarSign} label="Carteira em aberto" value={fmt(settlement?.summary.walletOutstanding ?? 0)} color="text-violet-600" />
            <KpiCard icon={DollarSign} label="Cashback em aberto" value={fmt(settlement?.summary.cashbackOutstanding ?? 0)} color="text-amber-600" />
            <KpiCard icon={AlertCircle} label="Estornos e disputas" value={fmt(settlement?.summary.reversals ?? 0)} color="text-red-600" />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Participante</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingSettlement ? (
                  Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>{Array.from({ length: 5 }).map((__, cell) => <TableCell key={cell}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : !settlement?.entries.length ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nenhum lançamento de liquidação no período.</TableCell></TableRow>
                ) : settlement.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm">{formatDate(entry.occurredAt)}</TableCell>
                    <TableCell className="capitalize text-sm">{entry.participantType}</TableCell>
                    <TableCell className="text-sm">{entry.category.replace(/_/g, " ")}</TableCell>
                    <TableCell><Badge variant={entry.settlementStatus === "reversed" ? "destructive" : "secondary"}>{entry.settlementStatus}</Badge></TableCell>
                    <TableCell className={`text-right font-medium ${entry.direction === "debit" ? "text-red-600" : "text-emerald-600"}`}>
                      {entry.direction === "debit" ? "−" : "+"}{fmt(entry.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Lançamento</DialogTitle></DialogHeader>
          <form onSubmit={handleCreatePayment} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo</label>
                <Select value={paymentType} onValueChange={setPaymentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receivable">A Receber</SelectItem>
                    <SelectItem value="payable">A Pagar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Categoria</label>
                <Select value={paymentCategory} onValueChange={setPaymentCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reservation">Reserva</SelectItem>
                    <SelectItem value="service">Serviço</SelectItem>
                    <SelectItem value="commission">Comissão</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição</label>
              <Input name="description" placeholder="Descrição do lançamento" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Valor (R$)</label>
                <Input name="amount" type="number" step="0.01" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vencimento</label>
                <Input name="dueDate" type="date" required defaultValue={localToday()} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Forma de Pagamento</label>
                <Select value={paymentMethodField} onValueChange={setPaymentMethodField}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                    <SelectItem value="bank_transfer">Transferência</SelectItem>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Parcelas</label>
                <Input name="installments" type="number" defaultValue="1" min="1" max="12" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Comprovante (opcional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              {receiptDataUrl ? (
                <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-green-50 border-green-200">
                  {receiptDataUrl.startsWith("data:image") ? (
                    <Image className="w-4 h-4 text-green-600 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-green-600 shrink-0" />
                  )}
                  <span className="text-xs text-green-700 flex-1 truncate">{receiptFileName}</span>
                  <Button
                    type="button" size="icon" variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => { setReceiptDataUrl(null); setReceiptFileName(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                >
                  <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground flex-1">Clique para selecionar (PDF, JPG, PNG)</span>
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsPaymentOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createPayment.isPending}>
                {createPayment.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isExpenseOpen} onOpenChange={setIsExpenseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar Despesa</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateExpense} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Categoria</label>
                <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transport">Transporte</SelectItem>
                    <SelectItem value="accommodation">Hospedagem</SelectItem>
                    <SelectItem value="food">Alimentação</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="administrative">Administrativo</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Forma de Pagamento</label>
                <Select value={expenseMethod} onValueChange={setExpenseMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="credit_card">Cartão</SelectItem>
                    <SelectItem value="bank_transfer">Transferência</SelectItem>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição *</label>
              <Input name="description" required placeholder="Descrição da despesa" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Valor (R$)</label>
                <Input name="amount" type="number" step="0.01" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vencimento</label>
                <Input name="dueDate" type="date" required defaultValue={localToday()} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observações</label>
              <Input name="notes" placeholder="Informações adicionais..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsExpenseOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createExpense.isPending}>
                {createExpense.isPending ? "Salvando..." : "Salvar Despesa"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isRuleOpen} onOpenChange={v => { setIsRuleOpen(v); if (!v) setEditingRule(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Editar Regra" : "Nova Regra de Comissão"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveRule} className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Regra *</label>
              <Input name="name" required defaultValue={editingRule?.name ?? ""} placeholder="Ex: Comissão Padrão Vendedores" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo</label>
                <Select value={ruleType} onValueChange={setRuleType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentual (%)</SelectItem>
                    <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{ruleType === "percentage" ? "Percentual (%)" : "Valor (R$)"}</label>
                <Input name="value" type="number" step="0.01" required defaultValue={editingRule?.value ?? ""} placeholder={ruleType === "percentage" ? "10" : "150.00"} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Aplica a</label>
              <Select name="appliesTo" defaultValue={editingRule?.appliesTo ?? "all"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as viagens</SelectItem>
                  <SelectItem value="national">Viagens nacionais</SelectItem>
                  <SelectItem value="international">Viagens internacionais</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setIsRuleOpen(false); setEditingRule(null); }}>Cancelar</Button>
              <Button type="submit" disabled={createRule.isPending || updateRule.isPending}>
                {createRule.isPending || updateRule.isPending ? "Salvando..." : "Salvar Regra"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
