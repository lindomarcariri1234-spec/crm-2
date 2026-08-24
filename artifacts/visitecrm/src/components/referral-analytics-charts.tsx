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
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, BarChart3, Trophy, Medal } from "lucide-react";
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

  const summary = data.summary;
  const ranking = data.ranking;
  const roiLabel = summary.acquisitionCost > 0
    ? `${summary.roiMultiple.toFixed(1)}× do investimento`
    : "Aguardando custo de aquisição";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground mb-1">Receita Atribuída</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600">{fmtCurrency(summary.attributedRevenue)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              ROI: <strong className="text-emerald-700">{roiLabel}</strong>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground mb-1">Conversões</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{summary.validReferrals}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Taxa de conversão: <strong className="text-foreground">{data.conversionRate}%</strong>
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground mb-1">Custo de Recompensas</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-600">{fmtCurrency(summary.rewardsPaid)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              CAC Médio: <strong className="text-foreground">{fmtCurrency(summary.cac)}</strong> por venda
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground mb-1">Cashback Pendente (Passivo)</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-600">{fmtCurrency(summary.rewardsPending)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Aguardando resgate ou aprovação
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">Evolução Mensal</CardTitle>
                <CardDescription>Volume de indicações e conversões nos últimos meses</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={analyticsExportUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Exportar Dados
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {monthlyData.length === 0 ? (
              <div className="h-52 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <BarChart3 className="w-8 h-8 opacity-30" />
                <p className="text-sm">Sem dados suficientes para exibição</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyData} margin={{ top: 12, right: 12, bottom: 4, left: -20 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                    cursor={{ fill: "#f9fafb" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  <Bar dataKey="created" name="Indicações" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="converted" name="Conversões" fill="#10B981" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Canais de Conversão</CardTitle>
            <CardDescription>Onde os links estão sendo compartilhados</CardDescription>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <div className="h-[260px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                <BarChart3 className="w-8 h-8 opacity-30" />
                <p className="text-sm text-center px-4">Utilize UTM sources para monitorar a origem dos links.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={channels}
                      dataKey="converted"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
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
                <div className="space-y-2">
                  {channels.slice(0, 5).map((ch: ReferralAnalyticsChannel, idx: number) => (
                    <div key={ch.source} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CHANNEL_COLORS[idx % CHANNEL_COLORS.length] }} />
                        <span className="text-muted-foreground font-medium truncate max-w-[120px]">{channelLabel(ch.source)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold">{ch.converted} conv.</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b bg-muted/20">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            Top Embaixadores
          </CardTitle>
          <CardDescription>
            Clientes que geraram o maior volume de vendas através de indicações
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow>
                  <TableHead className="w-16 text-center font-semibold">Pos</TableHead>
                  <TableHead className="font-semibold">Indicador</TableHead>
                  <TableHead className="text-right font-semibold">Conversões</TableHead>
                  <TableHead className="text-right font-semibold">Receita Gerada</TableHead>
                  <TableHead className="text-right font-semibold">Recompensas</TableHead>
                  <TableHead className="text-right font-semibold">Comissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.length > 0 ? (
                  ranking.map((row, i) => {
                    return (
                      <TableRow key={row.referrerId} className="hover:bg-muted/30">
                        <TableCell className="text-center font-medium">
                          {i === 0 ? <Medal className="w-5 h-5 text-yellow-500 mx-auto" /> :
                           i === 1 ? <Medal className="w-5 h-5 text-slate-400 mx-auto" /> :
                           i === 2 ? <Medal className="w-5 h-5 text-amber-700 mx-auto" /> :
                           <span className="text-muted-foreground">{i + 1}º</span>}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">{row.referrerName}</TableCell>
                        <TableCell className="text-right font-semibold">{row.conversions}</TableCell>
                        <TableCell className="text-right text-emerald-600 font-semibold">{fmtCurrency(row.attributedRevenue)}</TableCell>
                        <TableCell className="text-right text-amber-600 font-medium">{fmtCurrency(row.rewardsPaid)}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm">{fmtCurrency(row.commissionAmount)}</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <Trophy className="w-8 h-8 opacity-20" />
                        <p>Nenhuma conversão registrada neste período.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
