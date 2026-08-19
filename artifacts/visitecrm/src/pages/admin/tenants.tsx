import { useState } from "react";
import { useLocation } from "wouter";
import {
  useUpdateTenant,
  useActivateTenant,
  useListPlans,
} from "@workspace/api-client-react";
import { useAdminTenants, getAdminTenantsQueryKey, useSyncSuperadmin, type AdminTenant } from "@/hooks/use-admin-tenants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Users, ChevronLeft, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { TENANT_STATUS } from "@workspace/permissions";

/** Returns true when the tenant's trial has already expired. */
function isTrialExpired(tenant: AdminTenant) {
  if (tenant.status !== TENANT_STATUS.TRIAL || !tenant.trialEndsAt) return false;
  return new Date(tenant.trialEndsAt) < new Date();
}

const PAGE_SIZE = 15;

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

const STATUS_LABELS: Record<string, string> = {
  [TENANT_STATUS.ACTIVE]: "Ativo",
  [TENANT_STATUS.TRIAL]: "Trial",
  [TENANT_STATUS.SUSPENDED]: "Suspenso",
  [TENANT_STATUS.PENDING_PAYMENT]: "Pgto. Pendente",
  overdue: "Em atraso",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [TENANT_STATUS.ACTIVE]: "default",
  [TENANT_STATUS.TRIAL]: "secondary",
  [TENANT_STATUS.SUSPENDED]: "destructive",
  [TENANT_STATUS.PENDING_PAYMENT]: "outline",
  overdue: "destructive",
};

const PLAN_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  starter: "outline",
  pro: "secondary",
  enterprise: "default",
};

interface EditModalProps {
  tenant: AdminTenant | null;
  onClose: () => void;
}

function EditTenantModal({ tenant, onClose }: EditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateTenant = useUpdateTenant();
  const activateTenant = useActivateTenant();
  const { data: plans = [] } = useListPlans();

  const [planId, setPlanId] = useState(tenant?.planId ?? "");
  const [status, setStatus] = useState(tenant?.status ?? "trial");
  const [trialEndsAt, setTrialEndsAt] = useState<string>(() => {
    if (!tenant?.trialEndsAt) return "";
    const d = new Date(tenant.trialEndsAt);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  });

  if (!tenant) return null;

  const isBusy = updateTenant.isPending || activateTenant.isPending;
  const expired = isTrialExpired(tenant);

  async function handleSave() {
    if (!tenant) return;
    try {
      // When superadmin switches status to active via the select, use the
      // dedicated activate endpoint so suspendedAt/suspensionReason are cleared.
      if (status === TENANT_STATUS.ACTIVE && tenant.status !== TENANT_STATUS.ACTIVE) {
        await activateTenant.mutateAsync({ id: tenant.id });
      }
      await updateTenant.mutateAsync({
        id: tenant.id,
        data: {
          planId,
          status,
          trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getAdminTenantsQueryKey() });
      toast({ title: "Agência atualizada" });
      onClose();
    } catch {
      toast({ title: "Erro ao atualizar agência", variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar Agência</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="text-sm font-medium text-foreground mb-1">{tenant.name}</p>
            <p className="text-xs text-muted-foreground">{tenant.email}</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Plano</label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plans.length > 0
                  ? plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.monthlyPrice != null ? ` — R$ ${Number(p.monthlyPrice).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}/mês` : ""}
                      </SelectItem>
                    ))
                  : (
                    <>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </>
                  )
                }
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TENANT_STATUS.ACTIVE}>Ativo</SelectItem>
                <SelectItem value={TENANT_STATUS.TRIAL}>Trial</SelectItem>
                <SelectItem value={TENANT_STATUS.SUSPENDED}>Suspenso</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trial expiration — always visible so superadmin can set/extend/clear it */}
          <div className="space-y-1">
            <label className="text-sm font-medium flex items-center gap-2">
              Fim do Trial
              {expired && (
                <Badge variant="destructive" className="text-xs font-normal">Expirado</Badge>
              )}
            </label>
            <Input
              type="date"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
              placeholder="AAAA-MM-DD"
            />
            <p className="text-xs text-muted-foreground">
              Deixe em branco para remover. Altere para estender o período de avaliação.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isBusy}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isBusy}>
            {isBusy ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTenants() {
  const { data: tenants = [], isLoading } = useAdminTenants();
  const { data: plans = [] } = useListPlans();
  const syncSuperadmin = useSyncSuperadmin();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [editingTenant, setEditingTenant] = useState<AdminTenant | null>(null);
  const [, navigate] = useLocation();

  async function handleSyncSuperadmin() {
    try {
      const result = await syncSuperadmin.mutateAsync() as { already?: boolean };
      toast({
        title: result?.already ? "Já é superadmin" : "Papel superadmin sincronizado!",
        description: result?.already ? "Seu papel já estava correto." : "Seu papel foi atualizado para superadmin. Faça login novamente para aplicar.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ title: "Erro ao sincronizar papel", description: msg, variant: "destructive" });
    }
  }

  const planNameMap: Record<string, string> = {};
  for (const p of plans) {
    planNameMap[p.id] = p.name;
    if (p.slug) planNameMap[p.slug] = p.name;
  }

  const totalPages = Math.max(1, Math.ceil(tenants.length / PAGE_SIZE));
  const paginated = tenants.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tenants</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {tenants.length} agência{tenants.length !== 1 ? "s" : ""} cadastrada{tenants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSyncSuperadmin} disabled={syncSuperadmin.isPending} title="Sincronizar papel superadmin">
          <ShieldCheck className="w-4 h-4 mr-2" />
          {syncSuperadmin.isPending ? "Sincronizando..." : "Sync Superadmin"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-pulse text-muted-foreground">Carregando tenants...</div>
            </div>
          ) : tenants.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">Nenhum tenant encontrado</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agência</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plano</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cadastro</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuários</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((tenant) => (
                      <tr key={tenant.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">{tenant.name}</div>
                          <div className="text-xs text-muted-foreground">{tenant.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={PLAN_VARIANTS[tenant.planId] ?? "outline"}>
                            {planNameMap[tenant.planId] ?? PLAN_LABELS[tenant.planId] ?? tenant.planId}
                          </Badge>
                          {tenant.pendingPlanId && (
                            <div className="text-xs text-amber-600 mt-0.5">
                              → {PLAN_LABELS[tenant.pendingPlanId] ?? tenant.pendingPlanId}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <Badge variant={isTrialExpired(tenant) ? "destructive" : (STATUS_VARIANTS[tenant.status] ?? "outline")}>
                                {STATUS_LABELS[tenant.status] ?? tenant.status}
                              </Badge>
                              {isTrialExpired(tenant) && (
                                <span className="text-xs text-destructive font-medium">Expirado</span>
                              )}
                            </div>
                            {tenant.status === TENANT_STATUS.TRIAL && tenant.trialEndsAt && (
                              <span className="text-xs text-muted-foreground">
                                até {new Date(tenant.trialEndsAt).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(tenant.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Users className="w-3.5 h-3.5" />
                            {tenant.userCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                              className="h-7 w-7 p-0"
                              title="Ver detalhes"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingTenant(tenant)}
                              className="h-7 w-7 p-0"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    Página {page} de {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <EditTenantModal tenant={editingTenant} onClose={() => setEditingTenant(null)} />
    </div>
  );
}
