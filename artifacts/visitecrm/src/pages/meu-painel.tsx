import { useMemo } from "react";
import { localToday } from "@workspace/shared";
import { Link } from "wouter";
import {
  useGetMe,
  useListCommissions,
  useListReservations,
  useListDeals,
  useListSalesGoals,
  useGetMyCommissionRank,
  useGetDashboardSummary,
  useGetDashboardRevenueChart,
  useListPipelineStages,
  useListClients,
} from "@workspace/api-client-react";
import type { Commission } from "@workspace/api-client-react";
import { COMMISSION_STATUS, DEAL_STATUS, GOAL_STATUS } from "@workspace/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "@/lib/recharts-compat";
import {
  DollarSign, TrendingUp, Award, Target, Gauge, Medal,
  CalendarCheck, Briefcase, Users, Plus,
} from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

function currentMonth() {
  return localToday().slice(0, 7); // "YYYY-MM" in Brazil calendar (UTC-3)
}

export default function MeuPainel() {
  const { data: me } = useGetMe();

  const { data: allCommissions = [] } = useListCommissions();
  const { data: reservationsData } = useListReservations({ limit: 200 } as Parameters<typeof useListReservations>[0]);
  const reservations = reservationsData?.data ?? [];
  const { data: allDeals = [] } = useListDeals();
  const { data: goals = [] } = useListSalesGoals({ userId: me?.id, month: currentMonth() });
  const { data: rankData } = useGetMyCommissionRank();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: rawChartData, isLoading: loadingChart } = useGetDashboardRevenueChart({ period: "12m" });
  const chartData = rawChartData?.slice(-6);
  const { data: stages } = useListPipelineStages();
  const { data: openDeals } = useListDeals({ status: "open", ownerId: me?.id ?? undefined });
  const { data: myLeads, isLoading: loadingLeads } = useListClients({
    limit: 6, page: 1, classification: "lead", sortBy: "createdAt", sortOrder: "desc",
    sellerId: me?.id ?? undefined,
  });

  const myCommissions: Commission[] = useMemo(
    () => (me ? allCommissions.filter((c) => c.userId === me.id) : []),
    [allCommissions, me]
  );

  const totalRevenue = useMemo(
    () => myCommissions.reduce((sum, c) => sum + parseFloat(c.baseAmount ?? "0"), 0),
    [myCommissions]
  );

  const totalCommission = useMemo(
    () => myCommissions.reduce((sum, c) => sum + parseFloat(c.commissionAmount ?? "0"), 0),
    [myCommissions]
  );

  const pendingCommission = useMemo(
    () =>
      myCommissions
        .filter((c) => c.status === COMMISSION_STATUS.PENDING)
        .reduce((sum, c) => sum + parseFloat(c.commissionAmount ?? "0"), 0),
    [myCommissions]
  );

  const paidCommission = useMemo(
    () =>
      myCommissions
        .filter((c) => c.status === COMMISSION_STATUS.PAID)
        .reduce((sum, c) => sum + parseFloat(c.commissionAmount ?? "0"), 0),
    [myCommissions]
  );

  const myDeals = useMemo(
    () => (me ? allDeals.filter((d) => d.ownerId === me.id) : []),
    [allDeals, me]
  );

  // The reservations endpoint already applies the logged-in seller's server-side
  // scope. Do not use commission records as a proxy for ownership: a valid
  // reservation may not have a commission yet.
  const myReservations = reservations;

  const wonDeals = myDeals.filter((d) => d.status === DEAL_STATUS.WON).length;
  const closedDeals = myDeals.filter((d) => d.status === DEAL_STATUS.WON || d.status === DEAL_STATUS.LOST).length;
  const conversionRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;

  const month = currentMonth();
  const monthlyCommissions = myCommissions.filter((c) => c.createdAt.startsWith(month));
  const monthlyRevenue = monthlyCommissions.reduce((s, c) => s + parseFloat(c.baseAmount ?? "0"), 0);
  const monthlyCommissionTotal = monthlyCommissions.reduce((s, c) => s + parseFloat(c.commissionAmount ?? "0"), 0);

  const activeGoal = goals.find((g) => g.status === GOAL_STATUS.ACTIVE);
  const monthlyGoal = activeGoal?.goalAmount ?? me?.monthlyGoal ?? 0;
  const goalPct = monthlyGoal > 0 ? Math.min(100, (monthlyRevenue / monthlyGoal) * 100) : 0;

  const funnelData = useMemo(() => {
    if (!stages || !openDeals) return [];
    return stages.map((s) => ({
      name: s.name,
      value: openDeals.filter((d) => d.stageId === s.id).length,
      fill: s.color,
    }));
  }, [stages, openDeals]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="w-6 h-6 text-primary" />
            Meu Painel
          </h1>
          <p className="text-sm text-muted-foreground">
            Bem-vindo, {me?.name ?? "Vendedor"}! — desempenho e comissões
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/clients">
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-1" /> Nova Lead
            </Button>
          </Link>
          <Link href="/pipeline">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" /> Novo Negócio
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI cards — 5 columns */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" />
              Receita Gerada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtCurrency(totalRevenue)}</p>
            <p className="text-xs text-muted-foreground">{myCommissions.length} venda(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-600" />
              Comissão Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{fmtCurrency(totalCommission)}</p>
            <p className="text-xs text-muted-foreground">
              {fmtCurrency(paidCommission)} pago
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              Clientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold">{summary?.totalClients ?? 0}</p>
                <p className="text-xs text-muted-foreground">
                  {summary?.newClientsThisMonth ?? 0} novos este mês
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-purple-600" />
              Negócios Abertos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSummary ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold text-purple-600">{summary?.openDeals ?? 0}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtCurrency(summary?.dealsPipelineValue ?? 0)} no pipeline
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Medal className="w-4 h-4 text-yellow-500" />
              Ranking do Mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rankData?.rank != null ? (
              <>
                <p className="text-2xl font-bold text-primary">
                  #{rankData.rank}
                  <span className="text-base text-muted-foreground font-normal"> / {rankData.totalSellers}</span>
                </p>
                <p className="text-xs text-muted-foreground">entre vendedores</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-muted-foreground">—</p>
                <p className="text-xs text-muted-foreground">sem dados este mês</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Commission config banner */}
      {me?.commissionType && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <p className="text-xs text-muted-foreground">Tipo de comissão</p>
                <p className="font-semibold">
                  {me.commissionType === "fixed" ? "Valor fixo" : me.commissionType === "hybrid" ? "Híbrido (% + fixo)" : "Percentual"}
                </p>
              </div>
              {(me.commissionType === "percentage" || me.commissionType === "hybrid") && (
                <div>
                  <p className="text-xs text-muted-foreground">Taxa %</p>
                  <p className="font-semibold">{me.commissionRate ?? 0}%</p>
                </div>
              )}
              {(me.commissionType === "fixed" || me.commissionType === "hybrid") && (
                <div>
                  <p className="text-xs text-muted-foreground">Valor fixo</p>
                  <p className="font-semibold">{fmtCurrency(me.commissionFixed)}</p>
                </div>
              )}
              {monthlyGoal > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Meta mensal</p>
                  <p className="font-semibold">{fmtCurrency(monthlyGoal)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Conversão</p>
                <p className="font-semibold">{conversionRate}% ({wonDeals}/{closedDeals})</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Comissão pendente</p>
                <p className="font-semibold text-amber-600">{fmtCurrency(pendingCommission)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly goal progress */}
      {monthlyGoal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              Meta do Mês Atual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>Receita este mês</span>
              <span className="font-medium">
                {fmtCurrency(monthlyRevenue)} / {fmtCurrency(monthlyGoal)}
              </span>
            </div>
            <div className="relative h-5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  goalPct >= 100
                    ? "bg-green-500"
                    : goalPct >= 70
                    ? "bg-primary"
                    : goalPct >= 40
                    ? "bg-yellow-500"
                    : "bg-red-400"
                }`}
                style={{ width: `${goalPct}%` }}
              />
              <span className="absolute right-2 top-0 bottom-0 flex items-center text-xs font-bold text-foreground/80">
                {goalPct.toFixed(0)}%
              </span>
            </div>
            {monthlyCommissionTotal > 0 && (
              <p className="text-sm text-muted-foreground">
                Comissão neste mês:{" "}
                <strong className="text-green-600">{fmtCurrency(monthlyCommissionTotal)}</strong>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chart + Funnel */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Desempenho de Vendas</CardTitle>
            <CardDescription>Receita dos últimos 6 meses</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingChart ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Bar dataKey="revenue" name="Receita" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Meu Funil</CardTitle>
            <CardDescription>Negócios abertos por etapa</CardDescription>
          </CardHeader>
          <CardContent>
            {funnelData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sem negócios no funil.</p>
            ) : (
              <div className="space-y-2">
                {funnelData.map((stage) => (
                  <div key={stage.name} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.fill }} />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span>{stage.name}</span>
                        <span className="font-semibold">{stage.value}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${Math.min(100, (stage.value / Math.max(1, funnelData[0]?.value ?? 1)) * 100)}%`,
                            backgroundColor: stage.fill,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Leads + Reservas recentes */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Minhas Leads</CardTitle>
              <Link href="/clients?classification=lead">
                <Button variant="ghost" size="sm">Ver todas</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loadingLeads ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : !myLeads?.data.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma lead ativa.</p>
            ) : (
              <div className="space-y-2">
                {myLeads.data.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{client.pipelineStage ?? "Lead"}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">Lead</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Minhas Reservas Recentes</CardTitle>
              <Link href="/reservations">
                <Button variant="ghost" size="sm">Ver todas</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {myReservations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma reserva ainda.</p>
            ) : (
              <div className="space-y-2">
                {myReservations.slice(0, 6).map((r) => {
                  const comm = myCommissions.find((c) => c.reservationId === r.id);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {r.client.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{r.client.name}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[140px]">{r.trip.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-green-600">
                          {comm ? fmtCurrency(comm.commissionAmount) : fmtCurrency(r.totalValue)}
                        </p>
                        <Badge variant="secondary" className="text-xs">{r.status}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Commissions table */}
      <Card>
        <CardHeader>
          <CardTitle>Minhas Comissões</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
              {myCommissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Nenhuma comissão registrada ainda
                  </TableCell>
                </TableRow>
              ) : (
                myCommissions.slice(0, 15).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      {new Date(c.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </TableCell>
                    <TableCell>{fmtCurrency(c.baseAmount)}</TableCell>
                    <TableCell className="text-green-600 font-medium">
                      {fmtCurrency(c.commissionAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.status === COMMISSION_STATUS.PAID || c.status === COMMISSION_STATUS.APPROVED ? "default" : "secondary"}
                        className={`text-xs ${c.status === COMMISSION_STATUS.APPROVED ? "bg-blue-600" : ""}`}
                      >
                        {c.status === COMMISSION_STATUS.PAID
                          ? "Pago"
                          : c.status === COMMISSION_STATUS.APPROVED
                          ? "Aprovado"
                          : c.status === COMMISSION_STATUS.PENDING
                          ? "Pendente"
                          : c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
