import {
  useGetMetricsMrr,
  useGetMetricsChurn,
  useGetMetricsGrowth,
  useGetAdminStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line as _Line,
  BarChart,
  Bar as _Bar,
  XAxis as _XAxis,
  YAxis as _YAxis,
  CartesianGrid,
  Tooltip as _Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { LineProps, BarProps, XAxisProps, YAxisProps, TooltipProps } from "recharts";
import React from "react";
import { TrendingUp, Building2, AlertCircle, RefreshCw, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@workspace/shared";

// Recharts class components pre-date React 19's stricter JSX constraints.
// These re-casts preserve full prop types while satisfying React.ComponentType<P>.
type ValueType = number | string | (number | string)[];
type NameType = number | string;
const XAxis   = _XAxis   as unknown as React.ComponentType<XAxisProps>;
const YAxis   = _YAxis   as unknown as React.ComponentType<YAxisProps>;
const Tooltip = _Tooltip as unknown as React.ComponentType<TooltipProps<ValueType, NameType>>;
const Line    = _Line    as unknown as React.ComponentType<LineProps>;
const Bar     = _Bar     as unknown as React.ComponentType<BarProps>;

export default function AdminMetricsPage() {
  const { data: mrr = [], isLoading: mrrLoading, isError: mrrError } = useGetMetricsMrr();
  const { data: churn = [], isLoading: churnLoading, isError: churnError } = useGetMetricsChurn();
  const { data: growth = [], isLoading: growthLoading, isError: growthError } = useGetMetricsGrowth();
  const { data: stats } = useGetAdminStats();
  const anyError = growthError || mrrError || churnError;

  const currentMrr = mrr[mrr.length - 1]?.value ?? 0;
  const previousMrr = mrr[mrr.length - 2]?.value ?? 0;
  const mrrGrowth = previousMrr > 0 ? ((currentMrr - previousMrr) / previousMrr) * 100 : 0;

  const currentChurn = churn[churn.length - 1]?.value ?? 0;
  const currentActive = growth[growth.length - 1]?.value ?? 0;
  const lastMonthActive = growth[growth.length - 2]?.value ?? 0;
  const activeGrowth = lastMonthActive > 0 ? ((currentActive - lastMonthActive) / lastMonthActive) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Métricas do SaaS</h1>
        <p className="text-sm text-muted-foreground mt-1">Análise de crescimento, receita e churn dos últimos 12 meses</p>
      </div>

      {anyError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Erro ao carregar algumas métricas. Verifique suas permissões ou</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => window.location.reload()}>
            <RefreshCw className="w-3 h-3 mr-1" />
            tente novamente
          </Button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">MRR Atual</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{formatBRL(currentMrr)}</div>
            <p className={`text-xs mt-1 ${mrrGrowth >= 0 ? "text-green-600" : "text-destructive"}`}>
              {mrrGrowth >= 0 ? "+" : ""}{mrrGrowth.toFixed(1)}% vs mês anterior
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">Agências Ativas</CardTitle>
            <Building2 className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{stats?.byStatus?.active ?? currentActive}</div>
            <p className={`text-xs mt-1 ${activeGrowth >= 0 ? "text-green-600" : "text-destructive"}`}>
              {activeGrowth >= 0 ? "+" : ""}{activeGrowth.toFixed(1)}% vs mês anterior
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">Taxa de Churn</CardTitle>
            <TrendingDown className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{currentChurn.toFixed(2)}%</div>
            <p className="text-xs text-muted-foreground mt-1">Este mês</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">MRR Histórico (últimos 12 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          {mrrLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground animate-pulse">Carregando...</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={mrr} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => `R$${v}`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => [formatBRL(value), "MRR"]} />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Taxa de Churn Mensal (%)</CardTitle>
          </CardHeader>
          <CardContent>
            {churnLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground animate-pulse">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={churn} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value: number) => [`${value}%`, "Churn"]} />
                  <Bar dataKey="value" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Crescimento de Agências</CardTitle>
          </CardHeader>
          <CardContent>
            {growthLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground animate-pulse">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={growth} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value: number) => [value, "Agências"]} />
                  <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
