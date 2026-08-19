import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useGetTenant,
  getGetTenantQueryKey,
  useGetCurrentSubscription,
  useUpdateTenant,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/apiError";

/* ──────────────────── Upgrade Feature Modal ──────────────────── */

interface UpgradeFeatureModalProps {
  featureLabel: string;
  requiredPlanLabel: string;
  onClose: () => void;
}

function UpgradeFeatureModal({ featureLabel, requiredPlanLabel, onClose }: UpgradeFeatureModalProps) {
  function goToPlanTab() {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "plan");
    window.location.href = url.toString();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-muted-foreground" />
            Funcionalidade bloqueada
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{featureLabel}</span> está disponível
            apenas no plano <span className="font-semibold text-foreground">{requiredPlanLabel}</span> ou superior.
          </p>
          <p className="text-sm text-muted-foreground">
            Faça upgrade do seu plano para desbloquear esta e outras funcionalidades avançadas.
          </p>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={goToPlanTab}>
            Ver planos de upgrade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────── Features Tab ──────────────────── */

export function FeaturesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: fullTenant } = useGetTenant(tenantId ?? "", {
    query: {
      queryKey: getGetTenantQueryKey(tenantId ?? ""),
      enabled: !!tenantId,
    },
  });
  const { data: subData, isError: subError } = useGetCurrentSubscription();
  const updateTenant = useUpdateTenant();
  const [upgradeModal, setUpgradeModal] = useState<{ label: string; planLabel: string } | null>(null);

  const settings = ((fullTenant as (typeof fullTenant & { settings?: Record<string, unknown> }))?.settings ?? {});
  const referralsEnabled = settings.referralsEnabled !== false;
  const couponsEnabled = settings.couponsEnabled !== false;
  const seatMapEnabled = settings.seatMapEnabled !== false;

  const planLoaded = subData !== undefined || subError;
  const supportedFeatures: string[] = subData?.plan?.supportedFeatures ?? [];

  function isFeatureLocked(featureKey: string): boolean {
    if (!planLoaded) return false;
    return !supportedFeatures.includes(featureKey);
  }

  async function handleToggle(
    key: "referralsEnabled" | "couponsEnabled" | "seatMapEnabled",
    value: boolean,
    featureLabel: string,
    requiredPlanLabel: string,
  ) {
    if (!tenantId) return;
    try {
      await updateTenant.mutateAsync({ id: tenantId, data: { [key]: value } });
      toast({ title: value ? "Funcionalidade ativada" : "Funcionalidade desativada" });
      await queryClient.invalidateQueries({ queryKey: getGetTenantQueryKey(tenantId) });
    } catch (err) {
      const errData = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      if (errData?.code === "PLAN_UPGRADE_REQUIRED") {
        // Parse the required plan name from the API error message.
        // Message format: "… Faça upgrade para o plano <PlanName> ou superior …"
        // Fall back to the static label baked into the feature config if parsing fails.
        const parsed = errData.error?.match(/plano\s+([^\s]+)\s+ou superior/i)?.[1] ?? null;
        setUpgradeModal({ label: featureLabel, planLabel: parsed ?? requiredPlanLabel });
      } else {
        const message = extractApiError(err, "Erro ao salvar configuração");
        toast({ title: message, variant: "destructive" });
      }
    }
  }

  const FEATURES = [
    {
      key: "referralsEnabled" as const,
      featureKey: "referrals",
      label: "Programa de Indicação",
      description: "Permite que clientes gerem códigos de indicação e ganhem bônus por conversões",
      enabled: referralsEnabled,
      requiredPlanLabel: "Pro",
    },
    {
      key: "couponsEnabled" as const,
      featureKey: "coupons",
      label: "Cupons de Desconto",
      description: "Habilita a criação e uso de cupons de desconto na sua loja",
      enabled: couponsEnabled,
      requiredPlanLabel: "Pro",
    },
    {
      key: "seatMapEnabled" as const,
      featureKey: "seatMap",
      label: "Mapa de Assentos Personalizável",
      description: "Permite ocultar o mapa de assentos em viagens individuais — configurável em cada viagem",
      enabled: seatMapEnabled,
      requiredPlanLabel: "Pro",
    },
  ];

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Ative ou desative módulos do sistema para a sua agência.
      </p>
      <div className="rounded-md border divide-y">
        {FEATURES.map((f) => {
          const locked = isFeatureLocked(f.featureKey);
          return (
            <div
              key={f.key}
              className={`flex items-center justify-between px-4 py-4 gap-4 ${locked ? "cursor-pointer" : ""}`}
              onClick={locked ? () => setUpgradeModal({ label: f.label, planLabel: f.requiredPlanLabel! }) : undefined}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{f.label}</p>
                  {locked && (
                    <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                      <Lock className="w-3 h-3" />
                      Disponível no plano {f.requiredPlanLabel}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
              </div>
              <Switch
                data-testid={`feature-switch-${f.key}`}
                checked={f.enabled}
                aria-disabled={locked || updateTenant.isPending}
                className={locked ? "opacity-50" : ""}
                onCheckedChange={(v) => {
                  if (locked) {
                    setUpgradeModal({ label: f.label, planLabel: f.requiredPlanLabel! });
                    return;
                  }
                  handleToggle(f.key, v, f.label, f.requiredPlanLabel!);
                }}
                disabled={updateTenant.isPending && !locked}
              />
            </div>
          );
        })}
      </div>

      {upgradeModal && (
        <UpgradeFeatureModal
          featureLabel={upgradeModal.label}
          requiredPlanLabel={upgradeModal.planLabel}
          onClose={() => setUpgradeModal(null)}
        />
      )}
    </div>
  );
}
