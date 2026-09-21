import type { ReferralAnalyticsData, ReferralAnalyticsPeriod } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MousePointerClick, TrendingUp } from "lucide-react";
import { ReferralAnalyticsCharts } from "@/components/referral-analytics-charts";

interface ReferralAnalyticsSectionProps {
  data?: ReferralAnalyticsData;
  period: ReferralAnalyticsPeriod;
  isLoading: boolean;
  isError: boolean;
  analyticsExportUrl: string;
}

export function ReferralAnalyticsSection({
  data,
  period,
  isLoading,
  isError,
  analyticsExportUrl,
}: ReferralAnalyticsSectionProps) {
  return (
    <>
      {data ? (
        <ReferralAnalyticsCharts
          data={data}
          period={period}
          analyticsExportUrl={analyticsExportUrl}
        />
      ) : isError ? (
        <AnalyticsMessage message="Não foi possível carregar os dados de analytics." role="alert" />
      ) : (
        <AnalyticsMessage
          message={isLoading ? "Carregando dados de analytics..." : "Sem dados de analytics para este período."}
        />
      )}

      {data && data.funnel.created > 0 && (
        <FunnelCard
          title="Funil de conversão"
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          steps={[
            { label: "Criadas", count: data.funnel.created, color: "#3B82F6" },
            { label: "Visitadas", count: data.funnel.visited, color: "#8B5CF6" },
            { label: "Convertidas", count: data.funnel.converted, color: "#10B981" },
            { label: "Bônus pago", count: data.funnel.bonusPaid, color: "#F59E0B" },
          ]}
          total={data.funnel.created}
        />
      )}

      {data && data.trackingFunnel.uniqueVisitors > 0 && (
        <FunnelCard
          title="Visitas à landing page"
          description="Visitantes únicos que clicaram no link de indicação"
          icon={<MousePointerClick className="w-4 h-4 text-primary" />}
          steps={[
            { label: "Clicaram no link", count: data.trackingFunnel.uniqueVisitors, color: "#6366F1" },
            { label: "Chegaram ao checkout", count: data.trackingFunnel.checkoutStarts, color: "#8B5CF6" },
            { label: "Converteram", count: data.trackingFunnel.converted, color: "#10B981" },
          ]}
          total={data.trackingFunnel.uniqueVisitors}
        />
      )}
    </>
  );
}

function AnalyticsMessage({ message, role }: { message: string; role?: "alert" }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Analytics avançado de indicações
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-36 flex items-center justify-center text-muted-foreground text-sm" role={role}>
          {message}
        </div>
      </CardContent>
    </Card>
  );
}

interface FunnelStep {
  label: string;
  count: number;
  color: string;
}

function FunnelCard({
  title,
  description,
  icon,
  steps,
  total,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  steps: FunnelStep[];
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {steps.map((step) => {
            const percentage = total > 0 ? Math.round((step.count / total) * 100) : 0;
            return (
              <div key={step.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-32 shrink-0">{step.label}</span>
                <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                  <div
                    className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                    style={{ width: `${Math.max(percentage, 3)}%`, backgroundColor: step.color }}
                  >
                    <span className="text-[10px] font-semibold text-white">{step.count}</span>
                  </div>
                </div>
                <span className="text-xs font-medium w-10 text-right">{percentage}%</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}