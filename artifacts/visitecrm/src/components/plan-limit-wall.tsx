import { useLocation } from "wouter";
import { Lock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentSubscriptionResponse } from "@workspace/api-client-react";

interface PlanLimitWallProps {
  resource: "users" | "clients" | "trips";
  current?: number;
  limit?: number;
  planId?: string;
}

const RESOURCE_LABELS: Record<string, string> = {
  users: "usuários",
  clients: "clientes",
  trips: "viagens",
};

const RESOURCE_DESCRIPTIONS: Record<string, string> = {
  users: "Você atingiu o limite de usuários do seu plano atual.",
  clients: "Você atingiu o limite de clientes do seu plano atual.",
  trips: "Você atingiu o limite de viagens do seu plano atual.",
};

export function PlanLimitWall({ resource, current, limit, planId }: PlanLimitWallProps) {
  const [, navigate] = useLocation();

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-800">
          <Lock className="w-5 h-5" />
          Limite do plano atingido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-amber-700">
          {RESOURCE_DESCRIPTIONS[resource] ?? `Limite de ${RESOURCE_LABELS[resource] ?? resource} atingido.`}
        </p>
        {current !== undefined && limit !== undefined && (
          <div className="text-sm font-medium text-amber-800">
            {current} de {limit} {RESOURCE_LABELS[resource] ?? resource} utilizados
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => navigate("/configuracoes?tab=plan")}
          >
            <TrendingUp className="w-4 h-4 mr-1" />
            Fazer upgrade
          </Button>
        </div>
        <p className="text-xs text-amber-600">
          Faça upgrade do seu plano para adicionar mais {RESOURCE_LABELS[resource] ?? resource}.
        </p>
      </CardContent>
    </Card>
  );
}

interface PlanFeatureWallProps {
  featureLabel: string;
  requiredPlanLabel?: string;
  currentPlanLabel?: string;
  description?: string;
  canUpgrade?: boolean;
}

export function PlanFeatureWall({
  featureLabel,
  requiredPlanLabel,
  currentPlanLabel,
  description,
  canUpgrade = true,
}: PlanFeatureWallProps) {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 text-center px-4">
      <div className="rounded-full bg-muted p-4">
        <Lock className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="space-y-1.5 max-w-sm">
        <h2 className="text-lg font-semibold">{featureLabel} não disponível</h2>
        <p className="text-sm text-muted-foreground">
          {description ??
            (requiredPlanLabel
              ? `Esta funcionalidade está disponível a partir do plano ${requiredPlanLabel}.`
              : "Esta funcionalidade não está incluída no seu plano atual.")}
        </p>
        {(currentPlanLabel || requiredPlanLabel) && (
          <p className="text-xs text-muted-foreground/80 mt-1">
            {currentPlanLabel && <span>Seu plano: <strong>{currentPlanLabel}</strong></span>}
            {currentPlanLabel && requiredPlanLabel && <span className="mx-1.5">•</span>}
            {requiredPlanLabel && <span>Disponível no: <strong>{requiredPlanLabel}</strong></span>}
          </p>
        )}
      </div>
      {canUpgrade && (
        <Button onClick={() => navigate("/configuracoes?tab=plan")} className="gap-2">
          <TrendingUp className="w-4 h-4" />
          Ver planos
        </Button>
      )}
    </div>
  );
}

/**
 * Returns the name of the lowest plan with a higher sortOrder than the current
 * plan that also supports `featureKey`. Falls back to undefined if not found.
 */
export function getRequiredPlanLabel(
  subData: CurrentSubscriptionResponse | undefined,
  featureKey: string,
): string | undefined {
  if (!subData) return undefined;
  const currentSortOrder = subData.plan?.sortOrder ?? 0;
  const candidates = subData.plans
    .filter(p => p.sortOrder > currentSortOrder && p.supportedFeatures.includes(featureKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return candidates[0]?.name;
}

/**
 * Returns true when there is at least one active plan with a higher
 * sortOrder than the current plan that also includes `featureKey`.
 * This means the tenant *can* upgrade to unlock the feature.
 */
export function canUpgradeForFeature(
  subData: CurrentSubscriptionResponse | undefined,
  featureKey: string,
): boolean {
  if (!subData) return false;
  const currentSortOrder = subData.plan?.sortOrder ?? 0;
  return subData.plans.some(
    p => p.sortOrder > currentSortOrder && p.supportedFeatures.includes(featureKey),
  );
}

export function usePlanLimitError(error: unknown): {
  isLimitError: boolean;
  resource?: string;
  current?: number;
  limit?: number;
  message?: string;
} {
  if (!error || typeof error !== "object") return { isLimitError: false };
  const e = error as Record<string, unknown>;
  if (e["error"] === "limit_exceeded" || (e["message"] as string)?.includes("Limite do plano")) {
    return {
      isLimitError: true,
      resource: e["resource"] as string,
      current: e["current"] as number,
      limit: e["limit"] as number,
      message: e["message"] as string,
    };
  }
  return { isLimitError: false };
}
