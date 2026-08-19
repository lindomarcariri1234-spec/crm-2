import { useState, useEffect, FormEvent } from "react";
import { useLocation } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import {
  Loader2,
  Search,
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Tag,
  ShoppingBag,
  CreditCard,
  Copy,
  Check,
} from "lucide-react";
import { ROLES } from "@workspace/permissions";
import { publicStoreApi, PublicApiError, PublicStore, StoreOrder } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildVitrineTheme } from "@/lib/vitrineTheme";
import { PAYMENT_LABELS } from "@/pages/vitrine/_wizard/constants";
import { getOrderLookupFromStorage } from "./utils/storage";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Aguardando Pagamento",
  paid: "Pago",
  partially_paid: "Parcialmente Pago",
  refunded: "Estornado",
  cancelled: "Cancelado",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  processing: "Em Processamento",
  completed: "Concluído",
  cancelled: "Cancelado",
};

function PaymentStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    paid: "bg-green-100 text-green-800 border-green-200",
    unpaid: "bg-amber-100 text-amber-800 border-amber-200",
    partially_paid: "bg-blue-100 text-blue-800 border-blue-200",
    refunded: "bg-purple-100 text-purple-800 border-purple-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
  };
  const iconMap: Record<string, React.ReactElement> = {
    paid: <CheckCircle2 className="w-3.5 h-3.5" />,
    unpaid: <Clock className="w-3.5 h-3.5" />,
    partially_paid: <AlertCircle className="w-3.5 h-3.5" />,
    refunded: <AlertCircle className="w-3.5 h-3.5" />,
    cancelled: <XCircle className="w-3.5 h-3.5" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${colorMap[status] ?? "bg-gray-100 text-gray-800 border-gray-200"}`}>
      {iconMap[status]}
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function DiscountBreakdown({ order }: { order: StoreOrder }) {
  const referralAmt = order.referralDiscountAmount ?? 0;
  const couponAmt = order.couponDiscountAmount ?? 0;

  if (referralAmt <= 0 && couponAmt <= 0) return null;

  return (
    <div className="border border-green-200 bg-green-50 rounded-xl px-4 py-3 space-y-1.5">
      <p className="text-xs font-semibold text-green-700 mb-1">Descontos aplicados</p>
      {referralAmt > 0 && (
        <div className="flex justify-between text-sm text-green-800">
          <span>
            {order.referralDiscountType === "percentage" && order.referralDiscountPct != null
              ? `Desconto de indicação (${order.referralDiscountPct}%)`
              : "Desconto de indicação"}
          </span>
          <span className="font-semibold">− R$ {referralAmt.toFixed(2)}</span>
        </div>
      )}
      {couponAmt > 0 && (
        <div className="flex justify-between text-sm text-green-800">
          <span>{order.couponCode ? `Cupom ${order.couponCode}` : "Desconto de cupom"}</span>
          <span className="font-semibold">− R$ {couponAmt.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function PixQrBlock({ order }: { order: StoreOrder }) {
  const [copied, setCopied] = useState(false);
  if (!order.pixQrCode || !order.pixQrCodeUrl || order.paymentStatus === "paid") return null;
  function handleCopy() {
    void navigator.clipboard.writeText(order.pixCopyPaste ?? order.pixQrCode ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }
  return (
    <div className="p-5 bg-teal-50 border border-teal-200 rounded-xl space-y-4">
      <p className="font-semibold text-teal-900 text-base flex items-center gap-2">
        <span className="text-2xl">🔑</span> Pagamento via PIX
      </p>
      <div className="flex flex-col sm:flex-row gap-6 items-center">
        <div className="flex-shrink-0">
          <img
            src={order.pixQrCodeUrl}
            alt="QR Code PIX"
            className="w-44 h-44 rounded-lg border border-teal-300 bg-white p-1"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <div className="flex-1 space-y-3 text-sm">
          <p className="text-teal-800">
            Escaneie o QR Code com o aplicativo do seu banco ou use o código
            abaixo (<strong>Pix Copia e Cola</strong>).
          </p>
          <div className="bg-white border border-teal-200 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Código Pix Copia e Cola</p>
            <p className="font-mono text-xs break-all text-gray-700 leading-relaxed select-all">
              {order.pixCopyPaste ?? order.pixQrCode}
            </p>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copiado!" : "Copiar código PIX"}
          </button>
          <p className="text-xs text-teal-700">
            Após o pagamento, a confirmação pode levar alguns instantes.
          </p>
        </div>
      </div>
    </div>
  );
}

function OrderResult({ order, store }: { order: StoreOrder; store: PublicStore }) {
  const { colors } = buildVitrineTheme(store);
  const totalAmt = parseFloat(order.totalAmount);
  const subtotalAmt = parseFloat(order.subtotal);
  const depositAmt = order.depositAmount ? parseFloat(order.depositAmount) : 0;
  const paidAmt = depositAmt > 0 ? depositAmt : order.paidAt ? totalAmt : 0;
  const pendingAmt = totalAmt - paidAmt;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border p-6 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Número do Pedido</p>
            <p className="font-mono font-bold text-xl" style={{ color: colors.primary }}>
              {order.orderNumber}
            </p>
          </div>
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>

        <div
          className="h-0.5 rounded-full mb-4"
          style={{ background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})` }}
        />

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-0.5">Cliente</p>
            <p className="font-semibold">{order.customerName}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-0.5">Status do Pedido</p>
            <p className="font-semibold">{ORDER_STATUS_LABELS[order.status] ?? order.status}</p>
          </div>
          {order.paymentMethod && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-0.5">Forma de Pagamento</p>
              <p className="font-semibold">{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</p>
            </div>
          )}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-0.5">Data do Pedido</p>
            <p className="font-semibold">
              {new Intl.DateTimeFormat("pt-BR", {
                timeZone: "America/Sao_Paulo",
                day: "2-digit",
                month: "short",
                year: "numeric",
              }).format(new Date(order.createdAt))}
            </p>
          </div>
        </div>

        {order.items && order.items.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <ShoppingBag className="w-3.5 h-3.5" /> Itens do Pedido
            </p>
            <div className="space-y-2">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.productName}</span>
                    {item.variantLabel && (
                      <span className="text-muted-foreground ml-1">({item.variantLabel})</span>
                    )}
                    <span className="text-muted-foreground ml-1">× {item.quantity}</span>
                  </div>
                  <span className="font-semibold shrink-0 ml-4">
                    R$ {(item.unitPrice * item.quantity).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 text-sm border-t pt-4">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>R$ {subtotalAmt.toFixed(2)}</span>
          </div>

          <DiscountBreakdown order={order} />

          <div className="flex justify-between font-bold text-base border-t pt-2">
            <span>Total</span>
            <span style={{ color: colors.primary }}>R$ {totalAmt.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {depositAmt > 0 && depositAmt < totalAmt && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-2">
          <p className="text-xs font-semibold text-amber-700">Pagamento Parcial — Depósito Mínimo</p>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor total do pedido</span>
            <span className="font-semibold">R$ {totalAmt.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor pago agora (depósito)</span>
            <span className="font-semibold text-green-700">R$ {paidAmt.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-amber-200 pt-1">
            <span className="font-semibold">Restante a pagar</span>
            <span className="font-bold text-amber-900">R$ {Math.max(0, pendingAmt).toFixed(2)}</span>
          </div>
          <p className="text-xs text-amber-700">
            Sua reserva está confirmada! O restante poderá ser pago posteriormente.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
          <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <CreditCard className="w-3.5 h-3.5" /> Valor Pago
          </p>
          <p className="text-xl font-bold text-green-700">
            R$ {paidAmt.toFixed(2)}
          </p>
        </div>
        <div className="text-center p-4 bg-orange-50 rounded-xl border border-orange-200">
          <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Saldo Pendente
          </p>
          <p className="text-xl font-bold text-orange-700">
            R$ {Math.max(0, pendingAmt).toFixed(2)}
          </p>
        </div>
      </div>

      <PixQrBlock order={order} />

      {(store.contactWhatsapp || store.contactEmail) && (
        <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Precisa de ajuda?</p>
          <p>Entre em contato com {store.name}:</p>
          <div className="mt-1 space-y-0.5">
            {store.contactWhatsapp && <p>WhatsApp: {store.contactWhatsapp}</p>}
            {store.contactEmail && <p>E-mail: {store.contactEmail}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VitrineOrderTracking({
  slug,
  store,
  initialOrderNumber,
}: {
  slug: string;
  store?: PublicStore;
  initialOrderNumber?: string;
}) {
  const [, navigate] = useLocation();
  const { data: me } = useGetMe();
  const { colors } = buildVitrineTheme(store ?? { primaryColor: "", secondaryColor: "", accentColor: "" });

  const [orderNumber, setOrderNumber] = useState(initialOrderNumber ?? "");
  const [token, setToken] = useState("");
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    if (me?.role && me.role !== ROLES.CLIENT) {
      navigate("/dashboard");
    }
  }, [me?.role]);

  useEffect(() => {
    if (autoLoaded) return;
    setAutoLoaded(true);
    const stored = getOrderLookupFromStorage();
    if (!stored) return;
    if (stored.storeSlug && stored.storeSlug !== slug) return;
    if (stored.orderNumber && (!initialOrderNumber || initialOrderNumber === stored.orderNumber)) {
      if (!orderNumber) setOrderNumber(stored.orderNumber ?? "");
      if (stored.token) setToken(stored.token);
    }
  }, []);

  useEffect(() => {
    if (!autoLoaded) return;
    if (orderNumber && token && !order && !loading) {
      void doFetch(orderNumber, token);
    }
  }, [autoLoaded]);

  async function doFetch(num: string, tok: string) {
    if (!num.trim() || !tok.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await publicStoreApi.getOrder(slug, num.trim(), tok.trim());
      setOrder(result);
    } catch (e) {
      if (e instanceof PublicApiError) {
        setError("Pedido não encontrado. Verifique o número do pedido e o código de acesso.");
      } else {
        setError("Não foi possível consultar o pedido. Tente novamente em instantes.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setOrder(null);
    void doFetch(orderNumber, token);
  }

  const storeData = store as PublicStore | undefined;

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <div className="mb-8 text-center">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
          style={{ backgroundColor: colors.primary + "18" }}
        >
          <Package className="w-7 h-7" style={{ color: colors.primary }} />
        </div>
        <h1 className="text-2xl font-bold mb-1">Consultar Pedido</h1>
        <p className="text-muted-foreground text-sm">
          Informe o número do pedido e o código de acesso enviado por e-mail.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mb-8">
        <div className="space-y-1.5">
          <Label htmlFor="orderNumber">Número do Pedido</Label>
          <Input
            id="orderNumber"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="#2025-00001"
            className="font-mono"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Código de Acesso</Label>
          <Input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Código recebido por e-mail"
            className="font-mono text-sm"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            O código de acesso foi enviado para o seu e-mail ao realizar o pedido.
          </p>
        </div>
        <Button
          type="submit"
          className="w-full h-11 text-white font-semibold"
          style={{ backgroundColor: colors.primary }}
          disabled={!orderNumber.trim() || !token.trim() || loading}
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Consultando...</>
          ) : (
            <><Search className="w-4 h-4 mr-2" /> Consultar Pedido</>
          )}
        </Button>
      </form>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 mb-6">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {order && storeData && (
        <OrderResult order={order} store={storeData} />
      )}

      {order && !storeData && (
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border p-4 bg-white">
            <p className="font-semibold text-base mb-1">{order.orderNumber}</p>
            <p className="text-muted-foreground mb-3">Cliente: {order.customerName}</p>
            <div className="space-y-1.5 border-t pt-3">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>R$ {parseFloat(order.subtotal).toFixed(2)}</span>
              </div>
              <DiscountBreakdown order={order} />
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total</span>
                <span>R$ {parseFloat(order.totalAmount).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

