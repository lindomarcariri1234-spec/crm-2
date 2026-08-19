import { useState } from "react";
import { Link } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from "@/lib/recharts-compat";
import { useGetDashboardComparative } from "@workspace/api-client-react";
import {
  TrendingUp, TrendingDown, Minus, ArrowLeft, BarChart2, DollarSign, CalendarCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

function GrowthBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  if (value > 0) return <Badge variant="default" className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><TrendingUp className="w-3 h-3" />+{value.toFixed(1)}%</Badge>;
  if (value < 0) return <Badge variant="destructive" className="text-xs gap-1"><TrendingDown className="w-3 h-3" />{value.toFixed(1)}%</Badge>;
  return <Badge variant="secondary" className="text-xs gap-1"><Minus className="w-3 h-3" />0%</Badge>;
}

export default function HistoricoComparativo() {
  const [view, setView] = useState<"area" | "bar" | "line">("bar");
  const { data: months, isLoading } = useGetDashboardComparative();

  const totals = months?.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      expenses: acc.expenses + m.expenses,
      profit: acc.profit + m.profit,
      reservations: acc.reservations + m.reservations,
    }),
    { revenue: 0, expenses: 0, profit: 0, reservations: 0 }
  ) ?? { revenue: 0, expenses: 0, profit: 0, reservations: 0 };

  const lastMonth = months?.[months.length - 1];

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Histórico Comparativo</h1>
            <p className="text-muted-foreground text-sm">Evolução mensal dos últimos 12 meses</p>
          </div>
        </div>
        <div className="flex rounded-md border overflow-hidden text-xs">
          {([["area", "Área"], ["bar", "Barras"], ["line", "Linhas"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Receita 12 meses", value: formatCurrency(totals.revenue), icon: TrendingUp, color: "text-blue-600", growth: lastMonth?.revenueGrowth },
          { label: "Despesas 12 meses", value: formatCurrency(totals.expenses), icon: TrendingDown, color: "text-red-500", growth: null },
          { label: "Lucro Líquido", value: formatCurrency(totals.profit), icon: DollarSign, color: totals.profit >= 0 ? "text-emerald-600" : "text-red-600", growth: null },
          { label: "Reservas 12 meses", value: totals.reservations.toLocaleString("pt-BR"), icon: CalendarCheck, color: "text-indigo-600", growth: lastMonth?.reservationsGrowth },
        ].map(({ label, value, icon: Icon, color, growth }) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              {growth != null && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <GrowthBadge value={growth} />
                  <span className="text-xs text-muted-foreground">vs mês anterior</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main chart + detail table side-by-side on xl+ */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-muted-foreground" />
              Receita, Despesas e Lucro por Mês
            </CardTitle>
            <CardDescription>Últimos 12 meses — valores em R$</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : !months?.length ? (
              <p className="text-sm text-muted-foreground text-center py-16">Sem dados disponíveis.</p>
            ) : view === "area" ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cmpRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cmpExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cmpProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                  <Legend />
                  <Area type="monotone" dataKey="revenue" name="Receita" stroke="#3B82F6" fill="url(#cmpRevenue)" strokeWidth={2} />
                  <Area type="monotone" dataKey="expenses" name="Despesas" stroke="#EF4444" fill="url(#cmpExpenses)" strokeWidth={2} />
                  <Area type="monotone" dataKey="profit" name="Lucro" stroke="#10B981" fill="url(#cmpProfit)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : view === "bar" ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                  <Legend />
                  <Bar dataKey="revenue" name="Receita" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Despesas" fill="#EF4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="profit" name="Lucro" fill="#10B981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [formatCurrency(v), name]} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Receita" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="expenses" name="Despesas" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="profit" name="Lucro" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Month by month detail table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalhe Mês a Mês</CardTitle>
            <CardDescription>Comparativo de crescimento em relação ao mês anterior</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-3 font-medium">Mês</th>
                      <th className="text-right py-2 px-2 font-medium">Receita</th>
                      <th className="text-right py-2 px-2 font-medium">Var.</th>
                      <th className="text-right py-2 px-2 font-medium">Despesas</th>
                      <th className="text-right py-2 px-2 font-medium">Var.</th>
                      <th className="text-right py-2 px-2 font-medium">Lucro</th>
                      <th className="text-right py-2 px-2 font-medium">Var.</th>
                      <th className="text-right py-2 pl-2 font-medium">Reservas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(months ?? []).slice().reverse().map((m) => (
                      <tr key={m.key} className="hover:bg-muted/40">
                        <td className="py-2 pr-3 font-medium capitalize">{m.month}</td>
                        <td className="py-2 px-2 text-right text-blue-700 font-semibold">{formatCurrency(m.revenue)}</td>
                        <td className="py-2 px-2 text-right"><GrowthBadge value={m.revenueGrowth} /></td>
                        <td className="py-2 px-2 text-right text-red-600">{formatCurrency(m.expenses)}</td>
                        <td className="py-2 px-2 text-right"><GrowthBadge value={m.expensesGrowth} /></td>
                        <td className={`py-2 px-2 text-right font-semibold ${m.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(m.profit)}</td>
                        <td className="py-2 px-2 text-right"><GrowthBadge value={m.profitGrowth} /></td>
                        <td className="py-2 pl-2 text-right">{m.reservations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reservations chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reservas por Mês</CardTitle>
          <CardDescription>Volume de reservas criadas nos últimos 12 meses</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="reservations" name="Reservas" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
