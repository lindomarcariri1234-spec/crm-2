import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { TENANT_STATUS, INVOICE_STATUS } from "@workspace/permissions";
import {
  useGetTenantDetails,
  useListTenantUsers,
  useUpdateTenant,
  useSuspendTenant,
  useActivateTenant,
  useListAdminAuditLogs,
  useListPlans,
  useListAdminInvoices,
  useConfirmInvoicePayment,
  type TenantDetails,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ChevronLeft, Users, BarChart2, ScrollText, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTenantDetailsQueryKey } from "@workspace/api-client-react";

const STATUS_LABELS: Record<string, string> = {
  [TENANT_STATUS.ACTIVE]: "Ativo",
  [TENANT_STATUS.TRIAL]: "Trial",
  [TENANT_STATUS.SUSPENDED]: "Suspenso",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [TENANT_STATUS.ACTIVE]: "default",
  [TENANT_STATUS.TRIAL]: "secondary",
  [TENANT_STATUS.SUSPENDED]: "destructive",
};

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin",
  agencia: "Agência",
  consultor: "Consultor",
  financeiro: "Financeiro",
};

type Tab = "info" | "users" | "metrics" | "logs";

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR");
}

const STATUS_INVOICE_LABELS: Record<string, string> = {
  [INVOICE_STATUS.PENDING]: "Pendente",
  [INVOICE_STATUS.PENDING_PAYMENT]: "Aguardando Pgto.",
  [INVOICE_STATUS.PROCESSING]: "Processando",
  [INVOICE_STATUS.PAID]: "Pago",
  [INVOICE_STATUS.FAILED]: "Falhou",
  [INVOICE_STATUS.OVERDUE]: "Vencido",
  [INVOICE_STATUS.CANCELLED]: "Cancelado",
  canceled: "Cancelado",
};

function BillingSection({ tenant }: { tenant: TenantDetails }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: invoicesData, isLoading } = useListAdminInvoices({ tenantId: tenant.id });
  const confirmPayment = useConfirmInvoicePayment();
  const invoices = (invoicesData as unknown as Array<{ id: string; invoiceNumber: string | null; amount: string; status: string; dueDate: string | null; paidAt: string | null; paymentMethod: string | null }>) ?? [];

  async function handleConfirm(id: string) {
    try {
      await confirmPayment.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/invoices"] });
      toast({ title: "Pagamento confirmado" });
    } catch {
      toast({ title: "Erro ao confirmar pagamento", variant: "destructive" });
    }
  }

  return (
    <Card className="mt-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Faturamento e Assinatura</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Plano Atual</p>
            <p className="font-medium">{tenant.planId}</p>
          </div>
          {(tenant as unknown as { pendingPlanId?: string }).pendingPlanId && (
            <div>
              <p className="text-muted-foreground text-xs">Plano Solicitado</p>
              <p className="font-medium text-amber-700">{(tenant as unknown as { pendingPlanId?: string }).pendingPlanId}</p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground text-xs">Status</p>
            <p className="font-medium">{tenant.status}</p>
          </div>
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando faturas...</p>
        ) : invoices.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma fatura encontrada.</p>
        ) : (
          <div className="rounded border divide-y text-sm">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</p>
                  <p className="text-muted-foreground text-xs">
                    R$ {Number(inv.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    {inv.dueDate ? ` · vence ${new Date(inv.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
                  </p>
                </div>
                <Badge variant={inv.status === "paid" ? "default" : inv.status === "failed" || inv.status === "overdue" ? "destructive" : "secondary"} className="text-xs shrink-0">
                  {STATUS_INVOICE_LABELS[inv.status] ?? inv.status}
                </Badge>
                {(inv.status === "pending_payment" || inv.status === "processing") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => handleConfirm(inv.id)} disabled={confirmPayment.isPending}>
                    Confirmar PIX
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface InfoTabProps {
  tenant: TenantDetails;
}

function InfoTab({ tenant }: InfoTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateTenant = useUpdateTenant();
  const suspendTenant = useSuspendTenant();
  const activateTenant = useActivateTenant();
  const { data: plans = [] } = useListPlans();
  const [showConfirm, setShowConfirm] = useState<"suspend" | "activate" | null>(null);

  const [name, setName] = useState(tenant.name);
  const [email, setEmail] = useState(tenant.email);
  const [cnpj, setCnpj] = useState(tenant.cnpj ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [city, setCity] = useState(tenant.city ?? "");
  const [state, setState] = useState(tenant.state ?? "");
  const [zipCode, setZipCode] = useState(tenant.zipCode ?? "");
  const [planId, setPlanId] = useState(tenant.planId);
  const [trialEndsAt, setTrialEndsAt] = useState<string>(() => {
    if (!tenant.trialEndsAt) return "";
    const d = new Date(tenant.trialEndsAt as unknown as string);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  });
  const [whatsapp, setWhatsapp] = useState(tenant.whatsapp ?? "");
  const [phone, setPhone] = useState(tenant.phone ?? "");
  const [maxUsersOverride, setMaxUsersOverride] = useState(tenant.maxUsersOverride?.toString() ?? "");
  const [maxClientsOverride, setMaxClientsOverride] = useState(tenant.maxClientsOverride?.toString() ?? "");
  const [maxTripsOverride, setMaxTripsOverride] = useState(tenant.maxTripsOverride?.toString() ?? "");

  async function handleSave() {
    try {
      await updateTenant.mutateAsync({
        id: tenant.id,
        data: {
          name,
          planId,
          whatsapp: whatsapp || undefined,
          phone: phone || undefined,
          cnpj: cnpj || undefined,
          address: address || undefined,
          city: city || undefined,
          state: state || undefined,
          zipCode: zipCode || undefined,
          maxUsersOverride: maxUsersOverride ? parseInt(maxUsersOverride) : null,
          maxClientsOverride: maxClientsOverride ? parseInt(maxClientsOverride) : null,
          maxTripsOverride: maxTripsOverride ? parseInt(maxTripsOverride) : null,
          trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetTenantDetailsQueryKey(tenant.id) });
      toast({ title: "Agência atualizada" });
    } catch {
      toast({ title: "Erro ao atualizar agência", variant: "destructive" });
    }
  }

  async function handleSuspend() {
    try {
      await suspendTenant.mutateAsync({ id: tenant.id });
      await queryClient.invalidateQueries({ queryKey: getGetTenantDetailsQueryKey(tenant.id) });
      toast({ title: "Agência suspensa" });
    } catch {
      toast({ title: "Erro ao suspender agência", variant: "destructive" });
    }
    setShowConfirm(null);
  }

  async function handleActivate() {
    try {
      await activateTenant.mutateAsync({ id: tenant.id });
      await queryClient.invalidateQueries({ queryKey: getGetTenantDetailsQueryKey(tenant.id) });
      toast({ title: "Agência ativada" });
    } catch {
      toast({ title: "Erro ao ativar agência", variant: "destructive" });
    }
    setShowConfirm(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={STATUS_VARIANTS[tenant.status] ?? "outline"}>{STATUS_LABELS[tenant.status] ?? tenant.status}</Badge>
        {tenant.status === "trial" && tenant.trialEndsAt && new Date(tenant.trialEndsAt as unknown as string) < new Date() && (
          <Badge variant="destructive" className="text-xs">Trial expirado</Badge>
        )}
        {tenant.status !== TENANT_STATUS.SUSPENDED ? (
          <Button variant="destructive" size="sm" onClick={() => setShowConfirm("suspend")}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            Suspender
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowConfirm("activate")}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Ativar
          </Button>
        )}
        {tenant.status === "trial" && (
          <Button variant="outline" size="sm" onClick={() => setShowConfirm("activate")}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Ativar como Ativo
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Nome da Agência</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium">E-mail</label>
          <Input value={email} disabled className="opacity-60" />
        </div>
        <div>
          <label className="text-sm font-medium">Plano</label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
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
        <div>
          <label className="text-sm font-medium">Fim do Trial</label>
          <Input
            type="date"
            value={trialEndsAt}
            onChange={(e) => setTrialEndsAt(e.target.value)}
            placeholder="AAAA-MM-DD"
          />
          <p className="text-xs text-muted-foreground mt-1">Altere a data para estender ou encerrar o período de avaliação (apenas superadmin).</p>
        </div>
        <div>
          <label className="text-sm font-medium">CNPJ</label>
          <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0001-00" />
        </div>
        <div>
          <label className="text-sm font-medium">Telefone</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 1234-5678" />
        </div>
        <div>
          <label className="text-sm font-medium">WhatsApp</label>
          <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 99999-9999" />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-medium">Endereço</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, complemento" />
        </div>
        <div>
          <label className="text-sm font-medium">Cidade</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Estado</label>
            <Input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} placeholder="SP" />
          </div>
          <div>
            <label className="text-sm font-medium">CEP</label>
            <Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} placeholder="00000-000" />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Limites (sobrescrever plano)</h3>
          <p className="text-xs text-muted-foreground">Deixe em branco para usar os limites do plano. Preencha para definir limites específicos para esta agência.</p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium">Máx. Usuários</label>
            <Input
              type="number"
              value={maxUsersOverride}
              onChange={(e) => setMaxUsersOverride(e.target.value)}
              placeholder={tenant.planMaxUsers?.toString() ?? "do plano"}
              min={1}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Máx. Clientes</label>
            <Input
              type="number"
              value={maxClientsOverride}
              onChange={(e) => setMaxClientsOverride(e.target.value)}
              placeholder={tenant.planMaxClients?.toString() ?? "do plano"}
              min={1}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Máx. Viagens</label>
            <Input
              type="number"
              value={maxTripsOverride}
              onChange={(e) => setMaxTripsOverride(e.target.value)}
              placeholder={tenant.planMaxTrips?.toString() ?? "do plano"}
              min={1}
            />
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={updateTenant.isPending}>
        {updateTenant.isPending ? "Salvando..." : "Salvar Alterações"}
      </Button>

      <BillingSection tenant={tenant} />

      {showConfirm === "suspend" && (
        <Dialog open onOpenChange={() => setShowConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Suspender Agência</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Tem certeza que deseja suspender a agência <strong>{tenant.name}</strong>? Os usuários perderão o acesso.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirm(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleSuspend} disabled={suspendTenant.isPending}>
                {suspendTenant.isPending ? "Suspendendo..." : "Suspender"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {showConfirm === "activate" && (
        <Dialog open onOpenChange={() => setShowConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Ativar Agência</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Deseja reativar a agência <strong>{tenant.name}</strong>?</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirm(null)}>Cancelar</Button>
              <Button onClick={handleActivate} disabled={activateTenant.isPending}>
                {activateTenant.isPending ? "Ativando..." : "Ativar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function AdminTenantDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = params.id ?? "";
  const [tab, setTab] = useState<Tab>("info");

  const { data: tenant, isLoading: tenantLoading } = useGetTenantDetails(id);
  const { data: users = [], isLoading: usersLoading } = useListTenantUsers(id);
  const { data: logs = [], isLoading: logsLoading } = useListAdminAuditLogs({ tenantId: id });

  if (tenantLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Carregando agência...</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Agência não encontrada</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "info", label: "Informações", icon: Info },
    { id: "users", label: "Usuários", icon: Users },
    { id: "metrics", label: "Métricas", icon: BarChart2 },
    { id: "logs", label: "Logs", icon: ScrollText },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/admin/tenants")}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{tenant.name}</h1>
          <p className="text-muted-foreground text-xs">{tenant.email} · {tenant.slug}</p>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" && <InfoTab tenant={tenant} />}

      {tab === "users" && (
        <Card>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="flex items-center justify-center h-40 animate-pulse text-muted-foreground">Carregando...</div>
            ) : users.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">Nenhum usuário</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Nome</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">E-mail</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "metrics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Usuários</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{tenant.userCount}</div>
                {tenant.planMaxUsers != null && (
                  <div className="text-xs text-muted-foreground mt-1">Limite: {tenant.planMaxUsers}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Clientes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{tenant.clientCount}</div>
                {tenant.planMaxClients != null && (
                  <div className="text-xs text-muted-foreground mt-1">Limite: {tenant.planMaxClients}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Viagens</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{tenant.tripCount}</div>
                {tenant.planMaxTrips != null && (
                  <div className="text-xs text-muted-foreground mt-1">Limite: {tenant.planMaxTrips}</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Reservas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{tenant.reservationCount}</div>
              </CardContent>
            </Card>
          </div>
          {(tenant.planMaxUsers != null || tenant.planMaxClients != null || tenant.planMaxTrips != null) && (
            <p className="text-xs text-muted-foreground">
              Limites definidos pelo plano <strong>{tenant.planId}</strong>. Para alterar, edite o plano na aba Informações.
            </p>
          )}
        </div>
      )}

      {tab === "logs" && (
        <Card>
          <CardContent className="p-0">
            {logsLoading ? (
              <div className="flex items-center justify-center h-40 animate-pulse text-muted-foreground">Carregando...</div>
            ) : logs.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">Nenhum log registrado</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ação</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recurso</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.slice(0, 100).map((log) => (
                      <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(log.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{log.entityType}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground truncate max-w-[140px]">{log.entityId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
