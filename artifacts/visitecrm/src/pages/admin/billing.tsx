import { useState } from "react";
import {
  useListAdminInvoices,
  useCreateAdminInvoice,
  useUpdateAdminInvoice,
  useListTenants,
  useConfirmInvoicePayment,
  type InvoiceWithTenant,
} from "@workspace/api-client-react";
import { INVOICE_STATUS } from "@workspace/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, DollarSign, Clock, CheckCircle2, AlertCircle, QrCode } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAdminInvoicesQueryKey } from "@workspace/api-client-react";
import { formatCurrencyBRL as formatCurrency } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  [INVOICE_STATUS.PAID]: "Pago",
  [INVOICE_STATUS.PENDING]: "Pendente",
  [INVOICE_STATUS.OVERDUE]: "Vencido",
  [INVOICE_STATUS.CANCELLED]: "Cancelado",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  [INVOICE_STATUS.PAID]: "default",
  [INVOICE_STATUS.PENDING]: "secondary",
  [INVOICE_STATUS.OVERDUE]: "destructive",
  [INVOICE_STATUS.CANCELLED]: "outline",
};

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

interface CreateInvoiceModalProps {
  onClose: () => void;
}

function CreateInvoiceModal({ onClose }: CreateInvoiceModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createInvoice = useCreateAdminInvoice();
  const { data: tenants = [] } = useListTenants();

  const [tenantId, setTenantId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>(INVOICE_STATUS.PENDING);

  async function handleSave() {
    if (!tenantId || !amount) return;
    try {
      await createInvoice.mutateAsync({
        data: { tenantId, amount, description: description || undefined, dueDate: dueDate || undefined, status },
      });
      await queryClient.invalidateQueries({ queryKey: getListAdminInvoicesQueryKey() });
      toast({ title: "Fatura criada com sucesso" });
      onClose();
    } catch {
      toast({ title: "Erro ao criar fatura", variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Fatura</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-sm font-medium">Agência *</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar agência..." />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium">Descrição *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Assinatura Pro – Maio 2026" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium">Valor (R$) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="297.00" />
            </div>
            <div>
              <Label className="text-sm font-medium">Vencimento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={INVOICE_STATUS.PENDING}>Pendente</SelectItem>
                <SelectItem value={INVOICE_STATUS.PAID}>Pago</SelectItem>
                <SelectItem value={INVOICE_STATUS.OVERDUE}>Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createInvoice.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={createInvoice.isPending || !tenantId || !amount}>
            {createInvoice.isPending ? "Salvando..." : "Criar Fatura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PixViewModalProps {
  invoice: InvoiceWithTenant;
  onClose: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
}

function PixViewModal({ invoice, onClose, onConfirm, isConfirming }: PixViewModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  function copyCode() {
    if (invoice.pixCode) {
      navigator.clipboard.writeText(invoice.pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Código PIX copiado!" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5" />
            PIX — {invoice.tenantName ?? invoice.tenantId}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-2xl font-bold">{formatCurrency(invoice.amount)}</p>
            <p className="text-sm text-muted-foreground mt-1">{invoice.description}</p>
          </div>
          {invoice.pixQrCodeUrl && (
            <div className="flex justify-center">
              <img src={invoice.pixQrCodeUrl} alt="QR Code PIX" className="w-48 h-48 rounded-lg border" />
            </div>
          )}
          {invoice.pixCode && (
            <div className="flex gap-2">
              <Input value={invoice.pixCode} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="sm" onClick={copyCode}>
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : "Copiar"}
              </Button>
            </div>
          )}
          {invoice.pixExpiresAt && (
            <p className="text-xs text-center text-muted-foreground">
              Expira: {new Date(invoice.pixExpiresAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {invoice.status !== INVOICE_STATUS.PAID && (
            <Button onClick={onConfirm} disabled={isConfirming} className="bg-green-600 hover:bg-green-700 text-white">
              {isConfirming ? "Confirmando..." : "Confirmar Pagamento"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminBilling() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [pixInvoice, setPixInvoice] = useState<InvoiceWithTenant | null>(null);
  const { data: tenants = [] } = useListTenants();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateInvoice = useUpdateAdminInvoice();
  const confirmPayment = useConfirmInvoicePayment();

  const params: Record<string, string> = {};
  if (statusFilter !== "all") params.status = statusFilter;
  if (tenantFilter !== "all") params.tenantId = tenantFilter;

  const { data: invoices = [], isLoading, isError } = useListAdminInvoices(
    Object.keys(params).length > 0 ? params as Parameters<typeof useListAdminInvoices>[0] : undefined
  );

  const totalPaid = invoices.filter(i => i.status === INVOICE_STATUS.PAID).reduce((s, i) => s + Number(i.amount), 0);
  const totalPending = invoices.filter(i => i.status === INVOICE_STATUS.PENDING).reduce((s, i) => s + Number(i.amount), 0);
  const countOverdue = invoices.filter(i => i.status === INVOICE_STATUS.OVERDUE).length;
  const countPending = invoices.filter(i => i.status === INVOICE_STATUS.PENDING).length;

  async function handleMarkPaid(id: string) {
    try {
      await updateInvoice.mutateAsync({ id, data: { status: "paid" } });
      await queryClient.invalidateQueries({ queryKey: getListAdminInvoicesQueryKey() });
      toast({ title: "Fatura marcada como paga" });
    } catch {
      toast({ title: "Erro ao atualizar fatura", variant: "destructive" });
    }
  }

  async function handleConfirmPayment(invoiceId: string) {
    try {
      await confirmPayment.mutateAsync({ id: invoiceId });
      await queryClient.invalidateQueries({ queryKey: getListAdminInvoicesQueryKey() });
      toast({ title: "Pagamento confirmado! Plano ativado." });
      setPixInvoice(null);
    } catch {
      toast({ title: "Erro ao confirmar pagamento", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Faturamento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {invoices.length} fatura{invoices.length !== 1 ? "s" : ""} de assinatura de todas as agências
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nova Fatura
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">Total Recebido</CardTitle>
            <DollarSign className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totalPaid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">A Receber</CardTitle>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(totalPending)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">Pendentes</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{countPending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-muted-foreground">Vencidas</CardTitle>
            <AlertCircle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{countOverdue}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value={INVOICE_STATUS.PENDING}>Pendente</SelectItem>
            <SelectItem value={INVOICE_STATUS.PAID}>Pago</SelectItem>
            <SelectItem value={INVOICE_STATUS.OVERDUE}>Vencido</SelectItem>
            <SelectItem value={INVOICE_STATUS.CANCELLED}>Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Agência" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as agências</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter !== "all" || tenantFilter !== "all") && (
          <Button variant="ghost" onClick={() => { setStatusFilter("all"); setTenantFilter("all"); }}>
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-pulse text-muted-foreground">Carregando faturas...</div>
            </div>
          ) : isError ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive opacity-60" />
              <p className="text-sm">Erro ao carregar faturas. Verifique suas permissões.</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-muted-foreground">Nenhuma fatura encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agência</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Descrição</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Valor</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vencimento</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{invoice.tenantName ?? invoice.tenantId}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{invoice.description ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">{formatCurrency(invoice.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(invoice.dueDate)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[invoice.status] ?? "outline"}>
                          {STATUS_LABELS[invoice.status] ?? invoice.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {invoice.pixCode && invoice.status !== INVOICE_STATUS.PAID && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-blue-600 hover:text-blue-700"
                              onClick={() => setPixInvoice(invoice)}
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              PIX
                            </Button>
                          )}
                          {invoice.status !== INVOICE_STATUS.PAID && invoice.status !== INVOICE_STATUS.CANCELLED && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-green-600 hover:text-green-700"
                              onClick={() => handleMarkPaid(invoice.id)}
                              disabled={updateInvoice.isPending}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Pago
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && <CreateInvoiceModal onClose={() => setShowCreate(false)} />}
      {pixInvoice && (
        <PixViewModal
          invoice={pixInvoice}
          onClose={() => setPixInvoice(null)}
          onConfirm={() => handleConfirmPayment(pixInvoice.id)}
          isConfirming={confirmPayment.isPending}
        />
      )}
    </div>
  );
}
