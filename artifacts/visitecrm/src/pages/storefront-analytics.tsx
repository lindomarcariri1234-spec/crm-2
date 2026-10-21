import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  StorefrontAnalyticsSection,
  type StorefrontAnalyticsSummary,
} from "@/components/storefront-analytics-section";
import { storeApi } from "@/lib/storeApi";

type AnalyticsPeriod = 7 | 30 | 90;

export default function StorefrontAnalytics() {
  const [periodDays, setPeriodDays] = useState<AnalyticsPeriod>(30);
  const { data: me, isLoading: meLoading } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });
  const query = useQuery<StorefrontAnalyticsSummary>({
    queryKey: ["storefront-analytics", me?.tenantId ?? me?.id ?? "unassigned", periodDays],
    queryFn: () => storeApi.getStorefrontAnalytics(periodDays),
    enabled: Boolean(me),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comportamento da vitrine"
        description="Visualizações, buscas e interesse por produtos da sua loja pública."
        actions={
          <Select
            value={String(periodDays)}
            onValueChange={(value) => setPeriodDays(Number(value) as AnalyticsPeriod)}
          >
            <SelectTrigger className="w-[150px]" aria-label="Período dos dados">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <StorefrontAnalyticsSection
        data={query.data}
        loading={meLoading || query.isLoading || query.isFetching}
        error={query.isError}
        periodDays={periodDays}
        onRetry={() => { void query.refetch(); }}
      />
    </div>
  );
}
