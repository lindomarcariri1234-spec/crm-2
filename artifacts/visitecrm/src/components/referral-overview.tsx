import type { ReferralAnalyticsData, ReferralAnalyticsPeriod } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, DollarSign, Gift, Percent, TrendingUp, Users } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

interface ReferralOverviewProps {
  analyticsData?: ReferralAnalyticsData;
  analyticsPeriod: ReferralAnalyticsPeriod;
  onAnalyticsPeriodChange: (period: ReferralAnalyticsPeriod) => void;
  discountValue: number;
  discountType?: string | null;
  bonusValue: string | number;
  bonusLabel: string;
  expirationDays: number;
}

export function ReferralOverview({
  analyticsData,
  analyticsPeriod,
  onAnalyticsPeriodChange,
  discountValue,
  discountType,
  bonusValue,
  bonusLabel,
  expirationDays,
}: ReferralOverviewProps) {
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Desempenho no período</p>
          <div className="flex items-center gap-1.5">
            {([30, 90, 180] as ReferralAnalyticsPeriod[]).map((period) => (
              <Button
                key={period}
                size="sm"
                variant={analyticsPeriod === period ? "default" : "outline"}
                onClick={() => onAnalyticsPeriodChange(period)}
                className="text-xs h-6 px-2.5"
              >
                {period} dias
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" aria-hidden="true" />
                Indicações
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{analyticsData ? analyticsData.funnel.created : "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Check className="w-4 h-4" aria-hidden="true" />
                Convertidas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">{analyticsData ? analyticsData.funnel.converted : "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
                Taxa de conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">
                {analyticsData ? `${analyticsData.conversionRate}%` : "—"}
              </p>
              {analyticsData && (analyticsData.funnel.created > 0 || analyticsData.prevConversionRate > 0) && (() => {
                const delta = analyticsData.conversionRate - analyticsData.prevConversionRate;
                return (
                  <p className={`text-xs mt-0.5 font-medium ${delta >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {delta >= 0 ? "+" : ""}{delta}pp vs. período anterior
                  </p>
                );
              })()}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4" aria-hidden="true" />
                Desconto concedido
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{analyticsData ? fmtCurrency(analyticsData.discountGiven) : "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">nos últimos {analyticsPeriod} dias</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Percent className="w-4 h-4 text-primary" aria-hidden="true" />
              Desconto para o indicado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{discountValue}%</p>
            <p className="text-xs text-muted-foreground">{discountType === "percentage" ? "percentual" : "valor fixo"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" aria-hidden="true" />
              Bônus para quem indica
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmtCurrency(bonusValue)}</p>
            <p className="text-xs text-muted-foreground">{bonusLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
              Validade do código
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{expirationDays} dias</p>
            <p className="text-xs text-muted-foreground">após criação</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}