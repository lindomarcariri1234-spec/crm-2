import { useState } from "react";
import { localToday } from "@workspace/shared";
import {
  useListUsers,
  useListCommissions,
  useListReservations,
  useListDeals,
  useListPipelineStages,
  useUpdateUser,
  useListSalesGoals,
  useCreateSalesGoal,
  useUpdateSalesGoal,
  useDeleteSalesGoal,
} from "@workspace/api-client-react";
import type { UserProfile, Commission, Deal } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  DollarSign,
  TrendingUp,
  Award,
  ChevronRight,
  Target,
  Settings2,
  Plus,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ROLES, COMMISSION_STATUS, GOAL_STATUS } from "@workspace/permissions";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

interface SellerStats {
  user: UserProfile;
  salesCount: number;
  revenue: number;
  commission: number;
  conversionRate: number;
  dealCount: number;
  dealValue: number;
}

function GoalsChart({ stats }: { stats: SellerStats[] }) {
  const top = [...stats].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-4 h-4" />
          Metas vs Realizado — Por Vendedor
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Sem dados de venda para exibir
          </p>
        ) : (
          <div className="space-y-4">
            {top.map((s) => {
              const goal: number = (s.user.monthlyGoal as number | null) ?? 0;
              const pct = goal > 0 ? Math.min(100, (s.revenue / goal) * 100) : 0;
              return (
                <div key={s.user.id} className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium">{s.user.name}</span>
                    <span className="text-muted-foreground">
                      {fmtCurrency(s.revenue)}
                      {goal > 0 ? ` / ${fmtCurrency(goal)}` : " — sem meta"}
                    </span>
                  </div>
                  {goal > 0 ? (
                    <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          pct >= 100
                            ? "bg-green-500"
                            : pct >= 70
                            ? "bg-primary"
                            : pct >= 40
                            ? "bg-yellow-500"
                            : "bg-red-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute right-2 top-0 bottom-0 flex items-center text-xs font-bold text-foreground/80">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <div className="h-4 rounded-full bg-muted/50 flex items-center px-2">
                      <span className="text-xs text-muted-foreground">Meta não configurada</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PipelineView({
  deals,
  stages,
}: {
  deals: Deal[];
  stages: { id: string; name: string; color?: string | null }[];
}) {
  if (deals.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-4">
        Nenhum negócio no pipeline deste vendedor
      </p>
    );
  }

  const byStage: Record<string, Deal[]> = {};
  deals.forEach((d) => {
    const key = d.stageName ?? d.stageId;
    byStage[key] = [...(byStage[key] ?? []), d];
  });

  return (
    <div className="space-y-3">
      {Object.entries(byStage).map(([stage, stageDeals]) => {
        const total = stageDeals.reduce((s, d) => s + d.value, 0);
        return (
          <div key={stage} className="rounded-lg border p-3">
            <div className="flex justify-between items-center mb-2">
              <Badge variant="secondary" className="text-xs">
                {stage}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {stageDeals.length} negócio(s) — {fmtCurrency(total)}
              </span>
            </div>
            <div className="space-y-1">
              {stageDeals.slice(0, 5).map((d) => (
                <div key={d.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[200px]">{d.title}</span>
                  <span className="font-mono font-medium">{fmtCurrency(d.value)}</span>
                </div>
              ))}
              {stageDeals.length > 5 && (
                <p className="text-xs text-muted-foreground">+{stageDeals.length - 5} mais</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function currentMonthStr() {
  return localToday().slice(0, 7); // "YYYY-MM" in Brazil calendar (UTC-3)
}

function CommissionConfigDialog({
  seller,
  open,
  onClose,
}: {
  seller: UserProfile;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const updateUser = useUpdateUser();

  const [commissionType, setCommissionType] = useState<string>(
    seller.commissionType ?? "percentage"
  );
  const [commissionRate, setCommissionRate] = useState<string>(
    String(seller.commissionRate ?? "")
  );
  const [commissionFixed, setCommissionFixed] = useState<string>(
    String(seller.commissionFixed ?? "")
  );
  const [monthlyGoal, setMonthlyGoal] = useState<string>(
    String(seller.monthlyGoal ?? "")
  );

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateUser.mutateAsync({
        id: seller.id,
        data: {
          commissionType: commissionType as "percentage" | "fixed" | "hybrid" | "none",
          commissionRate: commissionRate !== "" ? parseFloat(commissionRate) : null,
          commissionFixed: commissionFixed !== "" ? parseFloat(commissionFixed) : null,
          monthlyGoal: monthlyGoal !== "" ? parseFloat(monthlyGoal) : null,
        },
      });
      toast({ title: "Comissão salva", description: `Configurações de ${seller.name} atualizadas.` });
      onClose();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Configurar Comissão — {seller.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Tipo de comissão</Label>
            <Select value={commissionType} onValueChange={setCommissionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentual (%)</SelectItem>
                <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                <SelectItem value="hybrid">Híbrido (% + fixo)</SelectItem>
                <SelectItem value="none">Sem comissão</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(commissionType === "percentage" || commissionType === "hybrid") && (
            <div className="space-y-1.5">
              <Label>Taxa percentual (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                placeholder="Ex: 5"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
              />
            </div>
          )}

          {(commissionType === "fixed" || commissionType === "hybrid") && (
            <div className="space-y-1.5">
              <Label>{commissionType === "hybrid" ? "Valor fixo adicional (R$)" : "Valor fixo por venda (R$)"}</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="Ex: 150.00"
                value={commissionFixed}
                onChange={(e) => setCommissionFixed(e.target.value)}
              />
            </div>
          )}

          {commissionType === "hybrid" && (
            <p className="text-xs text-muted-foreground rounded bg-muted/50 p-2">
              Híbrido: comissão = (% do valor da venda) + valor fixo por venda
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Meta mensal de receita (R$)</Label>
            <Input
              type="number"
              min={0}
              step={100}
              placeholder="Ex: 50000"
              value={monthlyGoal}
              onChange={(e) => setMonthlyGoal(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Usado no dashboard do vendedor e no gráfico de metas
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GoalsTab({ seller }: { seller: UserProfile }) {
  const { toast } = useToast();
  const { data: goals = [], refetch } = useListSalesGoals({ userId: seller.id });
  const createGoal = useCreateSalesGoal();
  const updateGoal = useUpdateSalesGoal();
  const deleteGoal = useDeleteSalesGoal();

  const curYear = Number(localToday().slice(0, 4)); // Brazil calendar year
  const [periodType, setPeriodType] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [year, setYear] = useState(String(curYear));
  const [monthStr, setMonthStr] = useState(currentMonthStr());
  const [quarter, setQuarter] = useState("1");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalQuantity, setGoalQuantity] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [adding, setAdding] = useState(false);

  function getMonthValue(): string {
    if (periodType === "monthly") return monthStr;
    if (periodType === "quarterly") {
      const startMonth = (parseInt(quarter) - 1) * 3 + 1;
      return `${year}-${String(startMonth).padStart(2, "0")}`;
    }
    return year;
  }

  function getPeriodLabel(g: { periodType?: string | null; month?: string | null; quarter?: number | null; year?: number | null }): string {
    if (g.periodType === "annual") return `Anual ${g.year ?? ""}`;
    if (g.periodType === "quarterly") return `T${g.quarter ?? "?"} ${g.year ?? ""}`;
    return g.month ?? "";
  }

  async function handleAdd() {
    if (!goalAmount) return;
    setAdding(true);
    try {
      await createGoal.mutateAsync({
        data: {
          userId: seller.id,
          periodType,
          year: parseInt(year),
          month: getMonthValue(),
          monthInt: periodType === "monthly"
            ? parseInt(monthStr.split("-")[1])
            : periodType === "quarterly"
            ? (parseInt(quarter) - 1) * 3 + 1
            : null,
          quarter: periodType === "quarterly" ? parseInt(quarter) : null,
          goalAmount: parseFloat(goalAmount),
          goalQuantity: goalQuantity ? parseFloat(goalQuantity) : null,
          bonusAmount: bonusAmount ? parseFloat(bonusAmount) : null,
        } as Parameters<typeof createGoal.mutateAsync>[0]["data"],
      });
      toast({ title: "Meta criada" });
      setGoalAmount("");
      setGoalQuantity("");
      setBonusAmount("");
      refetch();
    } catch {
      toast({ title: "Erro ao criar meta", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, status: string) {
    await updateGoal.mutateAsync({
      id,
      data: { status: status === GOAL_STATUS.ACTIVE ? "inactive" : GOAL_STATUS.ACTIVE },
    });
    refetch();
  }

  async function handleDelete(id: string) {
    await deleteGoal.mutateAsync({ id });
    refetch();
  }

  return (
    <div className="space-y-4 mt-2">
      {/* Add new goal */}
      <div className="rounded-lg border p-3 space-y-3">
        <p className="text-sm font-medium">Nova Meta</p>

        {/* Period type */}
        <div className="space-y-1">
          <Label className="text-xs">Período</Label>
          <Select value={periodType} onValueChange={(v) => setPeriodType(v as "monthly" | "quarterly" | "annual")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="quarterly">Trimestral</SelectItem>
              <SelectItem value="annual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Year */}
          <div className="space-y-1">
            <Label className="text-xs">Ano</Label>
            <Input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          {/* Month (monthly only) */}
          {periodType === "monthly" && (
            <div className="space-y-1">
              <Label className="text-xs">Mês</Label>
              <Input
                type="month"
                value={monthStr}
                onChange={(e) => setMonthStr(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* Quarter (quarterly only) */}
          {periodType === "quarterly" && (
            <div className="space-y-1">
              <Label className="text-xs">Trimestre</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">T1 (Jan–Mar)</SelectItem>
                  <SelectItem value="2">T2 (Abr–Jun)</SelectItem>
                  <SelectItem value="3">T3 (Jul–Set)</SelectItem>
                  <SelectItem value="4">T4 (Out–Dez)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Meta em R$</Label>
            <Input
              type="number"
              min={0}
              step={100}
              placeholder="50000"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Qtd. vendas (opcional)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="Ex: 10"
              value={goalQuantity}
              onChange={(e) => setGoalQuantity(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bônus (R$, opcional)</Label>
            <Input
              type="number"
              min={0}
              step={50}
              placeholder="Ex: 500"
              value={bonusAmount}
              onChange={(e) => setBonusAmount(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <Button size="sm" onClick={handleAdd} disabled={adding || !goalAmount}>
          <Plus className="w-3 h-3 mr-1" />
          {adding ? "Criando…" : "Adicionar Meta"}
        </Button>
      </div>

      {/* Goals list */}
      {goals.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-4">
          Nenhuma meta cadastrada para este vendedor
        </p>
      ) : (
        <div className="space-y-2">
          {goals.map((g) => {
            const progress = typeof g.progressPercentage === "number"
              ? g.progressPercentage
              : g.goalAmount && parseFloat(String(g.goalAmount)) > 0
              ? Math.min(100, ((parseFloat(String(g.achievedAmount ?? 0)) / parseFloat(String(g.goalAmount))) * 100))
              : 0;
            return (
              <div
                key={g.id}
                className="rounded-lg border p-3 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {g.periodType === "annual" ? "Anual" : g.periodType === "quarterly" ? "Trimestral" : "Mensal"}
                      </Badge>
                      {getPeriodLabel(g)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Meta: {fmtCurrency(g.goalAmount)}
                      {g.goalQuantity ? ` · ${g.goalQuantity} vendas` : ""}
                      {g.bonusAmount && parseFloat(String(g.bonusAmount)) > 0 ? ` · Bônus: ${fmtCurrency(g.bonusAmount)}` : ""}
                    </p>
                    {g.achievedAmount != null && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Realizado: {fmtCurrency(g.achievedAmount)}
                        {g.achievedQuantity ? ` · ${g.achievedQuantity} vendas` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={g.status === GOAL_STATUS.ACTIVE ? "default" : "secondary"}
                      className="cursor-pointer text-xs"
                      onClick={() => handleToggle(g.id, g.status)}
                    >
                      {g.status === GOAL_STATUS.ACTIVE ? "Ativa" : "Inativa"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDelete(g.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {g.status === GOAL_STATUS.ACTIVE && (
                  <div className="space-y-0.5">
                    <Progress value={progress} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground text-right">{Math.round(progress)}%</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Vendedores() {
  const { data: users = [] } = useListUsers();
  const { data: allCommissions = [] } = useListCommissions();
  const { data: reservationsData } = useListReservations({ limit: 500 });
  const reservations = reservationsData?.data ?? [];
  const { data: allDeals = [] } = useListDeals();
  const { data: stages = [] } = useListPipelineStages();

  const [selectedSeller, setSelectedSeller] = useState<SellerStats | null>(null);
  const [configSeller, setConfigSeller] = useState<UserProfile | null>(null);

  const sellers = users.filter(
    (u) => u.role === ROLES.SALES || u.role === ROLES.AGENCY_ADMIN || u.role === ROLES.SUPER_ADMIN
  );

  const stats: SellerStats[] = sellers.map((user) => {
    const userCommissions: Commission[] = allCommissions.filter(
      (c) => c.userId === user.id
    );
    const commission = userCommissions.reduce(
      (sum, c) => sum + parseFloat(c.commissionAmount ?? "0"),
      0
    );
    const revenue = userCommissions.reduce(
      (sum, c) => sum + parseFloat(c.baseAmount ?? "0"),
      0
    );
    const salesCount = userCommissions.length;
    const userDeals = allDeals.filter((d) => d.ownerId === user.id);
    const dealValue = userDeals.reduce((s, d) => s + d.value, 0);
    const wonDeals = userDeals.filter((d) => d.status === "won").length;
    const closedDeals = userDeals.filter(
      (d) => d.status === "won" || d.status === "lost"
    ).length;
    const conversionRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
    return { user, salesCount, revenue, commission, conversionRate, dealCount: userDeals.length, dealValue };
  });

  const totalSellers = stats.length;
  const totalSales = stats.reduce((s, x) => s + x.salesCount, 0);
  const totalCommission = stats.reduce((s, x) => s + x.commission, 0);
  const totalRevenue = stats.reduce((s, x) => s + x.revenue, 0);
  const avgConversion =
    stats.length > 0
      ? stats.reduce((s, x) => s + x.conversionRate, 0) / stats.length
      : 0;

  const sorted = [...stats].sort((a, b) => b.revenue - a.revenue);

  const sellerReservations = selectedSeller
    ? reservations.filter(
        (r) =>
          allCommissions.some(
            (c) => c.userId === selectedSeller.user.id && c.reservationId === r.id
          )
      )
    : [];

  const sellerCommissions: Commission[] = selectedSeller
    ? allCommissions.filter((c) => c.userId === selectedSeller.user.id)
    : [];

  const sellerDeals: Deal[] = selectedSeller
    ? allDeals.filter((d) => d.ownerId === selectedSeller.user.id)
    : [];

  const sellerGoal: number = selectedSeller
    ? ((selectedSeller.user.monthlyGoal as number | null) ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard de Vendedores</h1>
        <p className="text-sm text-muted-foreground">Desempenho e comissões da equipe de vendas</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Total de Vendedores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalSellers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Award className="w-4 h-4" />
              Total de Vendas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalSales}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Comissão Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{fmtCurrency(totalCommission)}</p>
            <p className="text-xs text-muted-foreground">
              de {fmtCurrency(totalRevenue)} em vendas
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Conversão Média
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{avgConversion.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">negócios ganhos/fechados</p>
          </CardContent>
        </Card>
      </div>

      {/* Goals vs actual chart (per-seller goals) */}
      <GoalsChart stats={stats} />

      {/* Ranking table */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking de Vendedores</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Comissão Config.</TableHead>
                <TableHead>Meta Mensal</TableHead>
                <TableHead>Vendas</TableHead>
                <TableHead>Receita</TableHead>
                <TableHead>Comissão</TableHead>
                <TableHead>Conversão</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    Nenhum vendedor com dados de comissão
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((s, idx) => {
                  const commType = s.user.commissionType;
                  const commLabel =
                    commType === "percentage"
                      ? `${s.user.commissionRate ?? 0}%`
                      : commType === "fixed"
                      ? fmtCurrency(s.user.commissionFixed)
                      : "—";
                  const goal: number = (s.user.monthlyGoal as number | null) ?? 0;
                  return (
                    <TableRow key={s.user.id}>
                      <TableCell>
                        <span
                          className={`font-bold ${
                            idx === 0
                              ? "text-yellow-500"
                              : idx === 1
                              ? "text-gray-400"
                              : idx === 2
                              ? "text-orange-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{s.user.name}</p>
                          <p className="text-xs text-muted-foreground">{s.user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {s.user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {commType ? (
                          <Badge
                            variant={commType === "none" ? "secondary" : "outline"}
                            className="text-xs font-mono"
                          >
                            {commType === "percentage"
                              ? `% ${commLabel}`
                              : commType === "fixed"
                              ? `Fixo ${commLabel}`
                              : "Nenhuma"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Não config.</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {goal > 0 ? (
                          <span className="text-sm">{fmtCurrency(goal)}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>{s.salesCount}</TableCell>
                      <TableCell>{fmtCurrency(s.revenue)}</TableCell>
                      <TableCell className="text-green-600 font-medium">
                        {fmtCurrency(s.commission)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={s.conversionRate} className="w-16 h-1.5" />
                          <span className="text-xs">{s.conversionRate}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Configurar comissão"
                            onClick={() => setConfigSeller(s.user)}
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Ver detalhes"
                            onClick={() => setSelectedSeller(s)}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Commission config dialog */}
      {configSeller && (
        <CommissionConfigDialog
          seller={configSeller}
          open={!!configSeller}
          onClose={() => setConfigSeller(null)}
        />
      )}

      {/* Per-seller detail dialog */}
      <Dialog open={!!selectedSeller} onOpenChange={() => setSelectedSeller(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedSeller?.user.name} — Detalhes
            </DialogTitle>
          </DialogHeader>
          {selectedSeller && (
            <div className="space-y-4">
              {/* Personal KPIs */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Vendas</p>
                  <p className="text-2xl font-bold">{selectedSeller.salesCount}</p>
                </div>
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Receita gerada</p>
                  <p className="text-xl font-bold">{fmtCurrency(selectedSeller.revenue)}</p>
                </div>
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Comissão</p>
                  <p className="text-xl font-bold text-green-600">
                    {fmtCurrency(selectedSeller.commission)}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground">Conversão</p>
                  <p className="text-2xl font-bold">{selectedSeller.conversionRate}%</p>
                </div>
              </div>

              {/* Goal progress (per-seller goal) */}
              {sellerGoal > 0 && (
                <div className="rounded-lg border p-3">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-medium">Meta mensal</span>
                    <span className="text-muted-foreground">
                      {fmtCurrency(selectedSeller.revenue)} / {fmtCurrency(sellerGoal)}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(100, (selectedSeller.revenue / sellerGoal) * 100)}
                    className="h-3"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.min(100, Math.round((selectedSeller.revenue / sellerGoal) * 100))}% da meta atingida
                  </p>
                </div>
              )}

              <Tabs defaultValue="commissions">
                <TabsList>
                  <TabsTrigger value="commissions">Comissões</TabsTrigger>
                  <TabsTrigger value="goals">Metas</TabsTrigger>
                  <TabsTrigger value="pipeline">
                    Pipeline ({sellerDeals.length})
                  </TabsTrigger>
                  <TabsTrigger value="reservations">
                    Reservas ({sellerReservations.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="commissions">
                  <div className="rounded-md border mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Valor Base</TableHead>
                          <TableHead>Comissão</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sellerCommissions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                              Nenhuma comissão registrada
                            </TableCell>
                          </TableRow>
                        ) : (
                          sellerCommissions.slice(0, 10).map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="text-sm">
                                {new Date(c.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                              </TableCell>
                              <TableCell>{fmtCurrency(c.baseAmount)}</TableCell>
                              <TableCell className="text-green-600">
                                {fmtCurrency(c.commissionAmount)}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={c.status === COMMISSION_STATUS.PAID ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {c.status === COMMISSION_STATUS.PAID ? "Pago" : c.status === COMMISSION_STATUS.PENDING ? "Pendente" : c.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="goals">
                  <GoalsTab seller={selectedSeller.user} />
                </TabsContent>

                <TabsContent value="pipeline" className="mt-2">
                  <PipelineView deals={sellerDeals} stages={stages} />
                </TabsContent>

                <TabsContent value="reservations">
                  {sellerReservations.length > 0 ? (
                    <div className="rounded-md border mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Voucher</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Viagem</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sellerReservations.slice(0, 8).map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs">{r.voucherCode}</TableCell>
                              <TableCell>{r.client.name}</TableCell>
                              <TableCell>{r.trip.name}</TableCell>
                              <TableCell>{fmtCurrency(r.totalValue)}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-xs">
                                  {r.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm text-center py-4">
                      Nenhuma reserva associada via comissão
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
