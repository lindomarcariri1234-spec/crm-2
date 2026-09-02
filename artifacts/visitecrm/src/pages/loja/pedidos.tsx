import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { localToday } from "@workspace/shared";
import { useToast } from "@/hooks/use-toast";
import { storeApi, StoreOrder } from "@/lib/storeApi";
import type { LinkedReservation } from "@/lib/linked-data";
import { PAYMENT_METHOD_LABELS as PAYMENT_METHODS } from "@/lib/labels";
import { formatDateTime as formatDate } from "@/lib/utils";
import { STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListLoadError } from "@/components/list-load-error";
import {
  ShoppingCart,
  Loader2,
  Search,
  Eye,
  Package,
  Download,
  ChevronLeft,
  ChevronRight,
  Copy,
  CheckCircle,
  ExternalLink,
  Link2,
} from "lucide-react";

const ORDER_STATUSES = [
  { value: STORE_ORDER_STATUS.PENDING, label: "Pendente", color: "bg-yellow-100 text-yellow-800" },
  { value: STORE_ORDER_STATUS.CONFIRMED, label: "Confirmado", color: "bg-blue-100 text-blue-800" },
  { value: STORE_ORDER_STATUS.PROCESSING, label: "Em Processamento", color: "bg-purple-100 text-purple-800" },
  { value: STORE_ORDER_STATUS.COMPLETED, label: "Concluído", color: "bg-green-100 text-green-800" },
  { value: STORE_ORDER_STATUS.CANCELLED, label: "Cancelado", color: "bg-red-100 text-red-800" },
];

const PAYMENT_STATUSES = [
  { value: STORE_PAYMENT_STATUS.PENDING, label: "Aguardando" },
  { value: STORE_PAYMENT_STATUS.PAID, label: "Pago" },
  { value: STORE_PAYMENT_STATUS.REFUNDED, label: "Reembolsado" },
  { value: STORE_PAYMENT_STATUS.FAILED, label: "Falhou" },
];

const FULFILLMENT_STATUSES = [
  { value: "unfulfilled", label: "Não Enviado" },
  { value: "partial", label: "Parcial" },
  { value: "fulfilled", label: "Enviado" },
];

function statusLabel(s: string) {
  return ORDER_STATUSES.find((x) => x.value === s)?.label ?? s;
}

function statusColor(s: string) {
  return ORDER_STATUSES.find((x) => x.value === s)?.color ?? "bg-gray-100 text-gray-800";
}

function paymentColor(s: string, paymentMethod?: string | null) {
  if (s === STORE_PAYMENT_STATUS.PAID) return "bg-green-100 text-green-800";
  if (s === STORE_PAYMENT_STATUS.REFUNDED) return "bg-purple-100 text-purple-800";
  if (s === STORE_PAYMENT_STATUS.FAILED) return "bg-red-100 text-red-800";
  if (s === STORE_PAYMENT_STATUS.PENDING && paymentMethod === "pix") return "bg-teal-100 text-teal-800";
  return "bg-yellow-100 text-yellow-800";
}

function paymentLabel(s: string, paymentMethod?: string | null) {
  if (s === STORE_PAYMENT_STATUS.PENDING && paymentMethod === "pix") return "PIX Pendente";
  return PAYMENT_STATUSES.find((x) => x.value === s)?.label ?? s;
}

function money(value: string | number | null | undefined) {
  return `R$ ${Number(value ?? 0).toFixed(2)}`;
}

function ReservationLinks({ reservations }: { reservations?: LinkedReservation[] }) {
  if (!reservations?.length) return null;
  return (
    <div className="space-y-1">
      {reservations.map((reservation) => (
        <div key={reservation.id} className="flex justify-between gap-2 text-sm" data-testid={`text-linked-reservation-${reservation.id}`}>
          <Link href={`/reservations/${reservation.id}`} className="font-mono text-primary hover:underline" data-testid={`link-linked-reservation-${reservation.id}`}>
            Reserva {reservation.reservationNumber}
          </Link>
          <span className={Number(reservation.balance) > 0 ? "text-amber-700" : "text-green-700"}>
            Saldo {money(reservation.balance)}
          </span>
        </div>
      ))}
    </div>
  );
}


function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground" title="Copiar">
      {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function OrderDetail({ orderId, onClose, onUpdated }: { orderId: string; onClose: () => void; onUpdated: (o: StoreOrder) => void }) {
  const { toast } = useToast();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    storeApi.getOrder(orderId).then((o) => {
      setOrder(o);
      setStatus(o.status);
      setPaymentStatus(o.paymentStatus);
      setFulfillmentStatus(o.fulfillmentStatus ?? "unfulfilled");
      setInternalNotes(o.internalNotes ?? "");
    }).catch(() => {
      toast({ title: "Erro ao carregar pedido", variant: "destructive" });
    }).finally(() => setLoading(false));
  }, [orderId]);

  async function save() {
    if (!order) return;
    setSaving(true);
    try {
      await storeApi.updateOrderStatus(order.id, status, paymentStatus, fulfillmentStatus, internalNotes);
      toast({ title: "Pedido atualizado!" });
      const patch = { ...order, status, paymentStatus, fulfillmentStatus, internalNotes };
      setOrder(patch);
      onUpdated(patch);
    } catch (err: unknown) {
      toast({
        title: "Erro",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) return null;

  return (
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            <p className="font-semibold">{order.customerName}</p>
            <p className="text-sm text-muted-foreground">{order.customerEmail}</p>
            {order.customerPhone && (
              <p className="text-sm text-muted-foreground">{order.customerPhone}</p>
            )}
            {order.customerCpf && (
              <p className="text-sm text-muted-foreground">CPF: {order.customerCpf}</p>
            )}
            {order.customerAddress && (
              <p className="text-xs text-muted-foreground mt-1">
                {[
                  (order.customerAddress as Record<string, string>).street,
                  (order.customerAddress as Record<string, string>).city,
                  (order.customerAddress as Record<string, string>).state,
                ].filter(Boolean).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Financeiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Subtotal (base)</span>
              <span>R$ {parseFloat(order.subtotal).toFixed(2)}</span>
            </div>
            {parseFloat(order.discountAmount) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Desconto {order.couponCode && `(${order.couponCode})`}</span>
                <span>- R$ {parseFloat(order.discountAmount).toFixed(2)}</span>
              </div>
            )}
            {order.taxAmount && parseFloat(order.taxAmount) > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Taxas</span>
                <span>R$ {parseFloat(order.taxAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t pt-1 mt-1">
              <span>Total</span>
              <span>R$ {parseFloat(order.totalAmount).toFixed(2)}</span>
            </div>
            {order.depositAmount && Number(order.depositAmount) > 0 && (
              <>
                <div className="flex justify-between text-sm text-blue-700 pt-1">
                  <span>Pago</span>
                  <span className="font-semibold">R$ {parseFloat(order.depositAmount).toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-sm text-amber-700">
              <span>Saldo</span>
              <span className="font-semibold">R$ {parseFloat(order.amountRemaining ?? order.totalAmount).toFixed(2)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
              <p>Pagamento: {PAYMENT_METHODS[order.paymentMethod ?? ""] ?? order.paymentMethod ?? "Não informado"}</p>
              {order.installments && order.installments > 1 && (
                <p>{order.installments}x de R$ {order.installmentAmount ? parseFloat(order.installmentAmount).toFixed(2) : "—"}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {(order.linkedReservations?.length || order.linkedReferral || order.linkedDeals?.length) ? (
        <Card data-testid={`card-order-links-${order.id}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Vínculos do pedido
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReservationLinks reservations={order.linkedReservations} />
            {order.linkedReferral && (
              <div className="text-sm border-t pt-2" data-testid={`text-linked-referral-${order.linkedReferral.id}`}>
                <span className="text-muted-foreground">Indicação:</span>{" "}
                <span className="font-mono font-medium">{order.linkedReferral.code}</span>
                {" · "}{order.linkedReferral.referrerName ?? "Indicador não informado"}
                {" · desconto "}{money(order.linkedReferral.discountAmount)}
              </div>
            )}
            {!!order.linkedDeals?.length && (
              <div className="text-sm border-t pt-2 text-muted-foreground" data-testid={`text-linked-deals-${order.id}`}>
                {order.linkedDeals.length} negócio{order.linkedDeals.length > 1 ? "s" : ""} vinculado{order.linkedDeals.length > 1 ? "s" : ""}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Itens do Pedido</CardTitle>
        </CardHeader>
        <CardContent>
          {order.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
          ) : (
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    {item.productImage && (
                      <img src={item.productImage} alt={item.productName} className="w-8 h-8 rounded object-cover" />
                    )}
                    <div>
                      <span className="font-medium text-sm">{item.productName}</span>
                      {item.sellerName && <Badge variant="outline" className="ml-2 text-[10px]">Parceiro: {item.sellerName}</Badge>}
                      {item.itemStatus && <Badge variant="outline" className="ml-1 text-[10px]">{item.itemStatus}</Badge>}
                      {item.variantLabel && (
                        <span className="text-xs text-muted-foreground ml-2">({item.variantLabel})</span>
                      )}
                      <span className="text-xs text-muted-foreground ml-2">x{item.quantity}</span>
                      {item.voucherCode && <span className="text-xs text-muted-foreground ml-2">Voucher: {item.voucherCode}</span>}
                      {item.cancellationReason && <span className="text-xs text-red-600 ml-2">Cancelado: {item.cancellationReason}</span>}
                    </div>
                  </div>
                  <span className="text-sm font-medium">
                    R$ {(item.unitPrice * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(order.paymentMethod === "pix" || order.pixCopyPaste) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dados do PIX</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {order.pixCopyPaste && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Copia e Cola</p>
                <div className="flex items-center gap-2 p-2 bg-muted rounded text-xs font-mono break-all">
                  <span className="flex-1">{order.pixCopyPaste}</span>
                  <CopyButton value={order.pixCopyPaste} />
                </div>
              </div>
            )}
            {order.pixQrCodeUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">QR Code</p>
                <img src={order.pixQrCodeUrl} alt="QR Code PIX" className="w-32 h-32" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(order.paymentMethod === "boleto" || order.boletoUrl) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dados do Boleto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {order.boletoBarcode && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Código de Barras</p>
                <div className="flex items-center gap-2 p-2 bg-muted rounded text-xs font-mono break-all">
                  <span className="flex-1">{order.boletoBarcode}</span>
                  <CopyButton value={order.boletoBarcode} />
                </div>
              </div>
            )}
            {order.boletoUrl && (
              <a
                href={order.boletoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Ver Boleto
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {order.customerNotes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Observações do Cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{order.customerNotes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Linha do Tempo</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">Criado:</span> {formatDate(order.createdAt)}</div>
          <div><span className="text-muted-foreground">Confirmado:</span> {formatDate(order.confirmedAt)}</div>
          <div><span className="text-muted-foreground">Pago:</span> {formatDate(order.paidAt)}</div>
          <div><span className="text-muted-foreground">Concluído:</span> {formatDate(order.completedAt)}</div>
          <div><span className="text-muted-foreground">Cancelado:</span> {formatDate(order.cancelledAt)}</div>
          <div><span className="text-muted-foreground">Reembolsado:</span> {formatDate(order.refundedAt)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Atualizar Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status do Pedido</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Pagamento</label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Envio</label>
              <Select value={fulfillmentStatus} onValueChange={setFulfillmentStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FULFILLMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notas Internas</label>
            <Textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Anotações visíveis apenas para a agência..."
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const LIMIT = 50;

export default function LojaPedidos() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await storeApi.getOrders({
        status: statusFilter,
        paymentStatus: paymentFilter,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit: LIMIT,
      });
      setOrders(res.data);
      setTotal(res.total);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      toast({
        title: "Erro ao carregar pedidos",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, paymentFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); }, [search, statusFilter, paymentFilter, dateFrom, dateTo]);

  function exportCSV() {
    const headers = ["Pedido", "Cliente", "E-mail", "Telefone", "CPF", "Itens", "Subtotal", "Desconto", "Total", "Método", "Status Pagamento", "Status Pedido", "Data"];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.customerName,
      o.customerEmail,
      o.customerPhone ?? "",
      o.customerCpf ?? "",
      o.itemCount ?? 0,
      parseFloat(o.subtotal).toFixed(2),
      parseFloat(o.discountAmount).toFixed(2),
      parseFloat(o.totalAmount).toFixed(2),
      PAYMENT_METHODS[o.paymentMethod ?? ""] ?? o.paymentMethod ?? "",
      paymentLabel(o.paymentStatus, o.paymentMethod),
      statusLabel(o.status),
      new Date(o.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    ]);
    const csv = [headers, ...rows].map((r) => r.map(String).map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos_${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pedidos</h1>
          <p className="text-muted-foreground text-sm mt-1">{total} pedido(s) encontrado(s)</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={orders.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Número, cliente ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={setPaymentFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Pagamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-muted-foreground whitespace-nowrap">De:</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Até:</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36"
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-muted-foreground"
          >
            Limpar datas
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <Card>
          <CardContent>
            <ListLoadError onRetry={load} message={loadError} />
          </CardContent>
        </Card>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum pedido encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Vínculos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelectedId(order.id)}>
                    <TableCell className="font-mono text-sm font-medium">
                      {order.orderNumber}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{order.customerName}</div>
                      <div className="text-xs text-muted-foreground">{order.customerEmail}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Package className="w-3 h-3" />
                        {order.itemCount ?? 0}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      <div data-testid={`text-order-total-${order.id}`}>{money(order.totalAmount)}</div>
                      <div className="text-xs text-muted-foreground">Base {money(order.subtotal)} · Desc. {money(order.discountAmount)}</div>
                      <div className="text-xs text-muted-foreground">Pago {money(order.depositAmount)} · Saldo {money(order.amountRemaining ?? order.totalAmount)}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {order.linkedReservations?.length ? (
                        <div data-testid={`text-order-reservations-${order.id}`}>
                          {order.linkedReservations.map((reservation) => reservation.reservationNumber).join(", ")}
                        </div>
                      ) : order.linkedReferral ? (
                        <div data-testid={`text-order-referral-${order.id}`}>Indicação {order.linkedReferral.code}</div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColor(order.paymentStatus, order.paymentMethod)}`}>
                        {paymentLabel(order.paymentStatus, order.paymentMethod)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); setSelectedId(order.id); }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Página {page} de {totalPages} ({total} pedidos)</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do Pedido</DialogTitle>
          </DialogHeader>
          {selectedId && (
            <OrderDetail
              orderId={selectedId}
              onClose={() => setSelectedId(null)}
              onUpdated={(updated) => {
                setOrders((o) => o.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
