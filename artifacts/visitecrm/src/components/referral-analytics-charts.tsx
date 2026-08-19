import {
  BarChart, Bar as _Bar, XAxis as _XAxis, YAxis as _YAxis,
  CartesianGrid, Tooltip as _Tooltip, Legend as _Legend, ResponsiveContainer,
  PieChart, Pie as _Pie, Cell, Sector as _Sector,
} from "recharts";
import type {
  BarProps, XAxisProps, YAxisProps, LegendProps, PieProps, SectorProps, TooltipProps,
} from "recharts";
import React, { useState } from "react";
import type { ReferralAnalyticsData, ReferralAnalyticsPeriod, ReferralAnalyticsChannel } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, ArrowRight, Download, BarChart3 } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

// Recharts ships class components whose context types pre-date React 19's stricter
// JSX element constraints (TS2786/TS2607). The re-casts below preserve each
// component's full prop type while satisfying the React.ComponentType<P> shape.
type ValueType = number | string | (number | string)[];
type NameType = number | string;
const XAxis    = _XAxis   as unknown as React.ComponentType<XAxisProps>;
const YAxis    = _YAxis   as unknown as React.ComponentType<YAxisProps>;
const Tooltip  = _Tooltip as unknown as React.ComponentType<TooltipProps<ValueType, NameType>>;
const Legend   = _Legend  as unknown as React.ComponentType<LegendProps>;
const Bar      = _Bar     as unknown as React.ComponentType<BarProps>;
const Pie      = _Pie     as unknown as React.ComponentType<PieProps>;
const Sector   = _Sector  as unknown as React.ComponentType<SectorProps>;

function MonthLabel(month: string) {
  const [y, m] = month.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" }).replace(" de ", "/");
}

function DeltaBadge({ current, prev, suffix = "" }: { current: number; prev: number; suffix?: string }) {
  if (prev === 0 && current === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const delta = current - prev;
  if (delta === 0) return <span className="text-xs text-muted-foreground flex items-center gap-1"><Minus className="w-3 h-3" />igual ao mês anterior</span>;
  if (delta > 0) return (
    <span className="text-xs text-green-600 flex items-center gap-1">
      <TrendingUp className="w-3 h-3" />+{delta}{suffix} vs. mês anterior
    </span>
  );
  return (
    <span className="text-xs text-red-500 flex items-center gap-1">
      <TrendingDown className="w-3 h-3" />{delta}{suffix} vs. mês anterior
    </span>
  );
}

const CHANNEL_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#F97316"];
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  qr_code: "QR Code",
  qrcode: "QR Code",
  direct: "Link direto",
  direto: "Link direto",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "E-mail",
  sms: "SMS",
};

function channelLabel(src: string) {
  return CHANNEL_LABELS[src.toLowerCase()] ?? src.charAt(0).toUpperCase() + src.slice(1);
}

function CustomPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {(percent * 100).toFixed(0)}%
    </text>
  );
}

interface Props {
  data: ReferralAnalyticsData;
  period: ReferralAnalyticsPeriod;
  analyticsExportUrl: string;
}

export function ReferralAnalyticsCharts({ data, period, analyticsExportUrl }: Props) {
  const [activePieIdx, setActivePieIdx] = useState<number | null>(null);

  const monthlyData = (data.monthly ?? []).map((m) => ({
    ...m,
    label: MonthLabel(m.month),
  }));

  const channels = data.channels ?? [];
  const roi = data.roi ?? { totalBonusPaid: 0, totalReferredRevenue: 0 };
  const currentMonth = data.currentMonth ?? { referrals: 0, conversions: 0, bonusPaid: 0 };
  const prevMonth = data.prevMonth ?? { referrals: 0, conversions: 0, bonusPaid: 0 };

  const roiRatio = roi.totalBonusPaid > 0 && roi.totalReferredRevenue > 0
    ? (roi.totalReferredRevenue / roi.totalBonusPaid).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {/* Month comparison cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Este mês — indicações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{currentMonth.referrals}</p>
            <DeltaBadge current={currentMonth.referrals} prev={prevMonth.referrals} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Este mês — conversões</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{currentMonth.conversions}</p>
            <DeltaBadge current={currentMonth.conversions} prev={prevMonth.conversions} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Este mês — bônus pagos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{fmtCurrency(currentMonth.bonusPaidAmount)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{currentMonth.bonusPaid} pagamentos</p>
            <DeltaBadge current={currentMonth.bonusPaidAmount} prev={prevMonth.bonusPaidAmount} suffix=" R$" />
          </CardContent>
        </Card>
      </div>

      {/* Monthly bar chart + channel donut side by side on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">Indicações por mês (12 meses)</CardTitle>
                <CardDescription>Criadas vs. convertidas mês a mês</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={analyticsExportUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Exportar relatório
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {monthlyData.length === 0 ? (
              <div className="h-52 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <BarChart3 className="w-8 h-8 opacity-30" />
                <p className="text-sm">Sem dados de indicações para os últimos 12 meses</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                    cursor={{ fill: "#f9fafb" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="created" name="Criadas" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="converted" name="Convertidas" fill="#10B981" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Channel donut chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Canal de origem</CardTitle>
            <CardDescription>Conversões por canal de compartilhamento</CardDescription>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <div className="h-52 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <BarChart3 className="w-8 h-8 opacity-30" />
                <p className="text-sm text-center">Sem dados de canal. Compartilhe com UTM sources para ver a distribuição.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={channels}
                      dataKey="converted"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={72}
                      paddingAngle={2}
                      labelLine={false}
                      label={CustomPieLabel}
                      activeIndex={activePieIdx ?? undefined}
                      activeShape={(props: Record<string, unknown>) => <Sector {...(props as Record<string, any>)} outerRadius={Number(props.outerRadius) + 6} />}
                      onMouseEnter={(_: unknown, idx: number) => setActivePieIdx(idx)}
                      onMouseLeave={() => setActivePieIdx(null)}
                    >
                      {channels.map((_ch: ReferralAnalyticsChannel, idx: number) => (
                        <Cell key={idx} fill={CHANNEL_COLORS[idx % CHANNEL_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [`${v} conversões`, channelLabel(name)]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {channels.slice(0, 5).map((ch: ReferralAnalyticsChannel, idx: number) => (
                    <div key={ch.source} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHANNEL_COLORS[idx % CHANNEL_COLORS.length] }} />
                        <span className="text-muted-foreground truncate max-w-[100px]">{channelLabel(ch.source)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-medium">{ch.converted} conv.</span>
                        {ch.visitors > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                            {ch.visitors} vis.
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ROI card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ROI do programa de indicações</CardTitle>
          <CardDescription>Retorno sobre o investimento em bônus pagos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Bônus pago (custo)</p>
              <p className="text-2xl font-bold text-red-500">{fmtCurrency(roi.totalBonusPaid)}</p>
              <p className="text-xs text-muted-foreground mt-1">total de bônus quitados</p>
            </div>
            <div className="flex flex-col items-center justify-center">
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Receita gerada por indicações</p>
              <p className="text-2xl font-bold text-green-600">{fmtCurrency(roi.totalReferredRevenue)}</p>
              <p className="text-xs text-muted-foreground mt-1">valor de reservas originadas por indicação</p>
            </div>
          </div>
          {roiRatio && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-muted rounded-full h-3">
                  <div
                    className="bg-green-500 h-3 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (roi.totalReferredRevenue / (roi.totalReferredRevenue + roi.totalBonusPaid)) * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className="text-sm font-semibold whitespace-nowrap">
                  {roiRatio}× ROI — para cada R$1 em bônus, R${roiRatio} em receita
                </span>
              </div>
            </div>
          )}
          {roi.totalBonusPaid === 0 && roi.totalReferredRevenue === 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              Os dados de ROI aparecerão após o primeiro bônus pago e as primeiras reservas via indicação.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
