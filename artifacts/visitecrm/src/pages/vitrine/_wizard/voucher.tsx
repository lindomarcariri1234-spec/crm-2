import { useState, useEffect } from "react";
import { MapPin, Calendar, Clock, Armchair } from "lucide-react";
import QRCode from "qrcode";
import { PublicStore, StoreProduct } from "@/lib/storeApi";
import type { FinancialSummary } from "@/lib/linked-data";
import { calculateTripDuration } from "@/lib/tripDuration";
import { fmtDate, PAYMENT_LABELS } from "./constants";

export function Voucher({
  order,
  product,
  store,
  customerName,
  seats,
  paymentMethod,
  referralDiscount = 0,
  referralDiscountType,
  referralDiscountPct,
  couponDiscount = 0,
  couponCode,
  financialSummary,
}: {
  order: { orderNumber: string; totalAmount: string; createdAt: string };
  product: StoreProduct;
  store: PublicStore;
  customerName: string;
  seats: (number | string)[];
  paymentMethod: string;
  referralDiscount?: number;
  referralDiscountType?: string;
  referralDiscountPct?: number;
  couponDiscount?: number;
  couponCode?: string;
  financialSummary: FinancialSummary;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    if (!order.orderNumber) return;

    const QR_SIZE = 160;
    const LOGO_RATIO = 0.25;

    QRCode.toDataURL(order.orderNumber, {
      width: QR_SIZE,
      margin: 1,
      errorCorrectionLevel: "H",
    })
      .then((qrUrl) => {
        if (!store.logoUrl) {
          setQrDataUrl(qrUrl);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = QR_SIZE;
        canvas.height = QR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setQrDataUrl(qrUrl);
          return;
        }

        const qrImg = new Image();
        qrImg.onload = () => {
          ctx.drawImage(qrImg, 0, 0, QR_SIZE, QR_SIZE);

          const logoImg = new Image();
          logoImg.crossOrigin = "anonymous";
          logoImg.onload = () => {
            const logoSize = Math.round(QR_SIZE * LOGO_RATIO);
            const padding = 4;
            const boxSize = logoSize + padding * 2;
            const x = (QR_SIZE - boxSize) / 2;
            const y = (QR_SIZE - boxSize) / 2;

            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.roundRect(x, y, boxSize, boxSize, 6);
            ctx.fill();

            ctx.drawImage(logoImg, x + padding, y + padding, logoSize, logoSize);
            setQrDataUrl(canvas.toDataURL("image/png"));
          };
          logoImg.onerror = () => {
            setQrDataUrl(qrUrl);
          };
          logoImg.src = store.logoUrl!;
        };
        qrImg.src = qrUrl;
      })
      .catch(() => {});
  }, [order.orderNumber, store.logoUrl]);

  const startDate = product.departureDate ?? product.startDate;
  const images = product.images ?? [];

  return (
    <div
      id="voucher"
      className="border-2 border-dashed border-primary/40 rounded-2xl p-6 bg-white max-w-lg mx-auto print:block print:border-solid print:border-gray-300"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          {store.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className="h-10 object-contain" />
          ) : (
            <p className="font-bold text-lg" style={{ color: store.primaryColor }}>
              {store.name}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {financialSummary.reservationValid ? "Voucher de Reserva" : "Comprovante de Pedido Pendente"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Pedido</p>
          <p className="font-mono font-bold text-primary text-lg">{order.orderNumber}</p>
        </div>
      </div>

      <div
        className="h-1 rounded-full mb-4"
        style={{ background: `linear-gradient(90deg, ${store.primaryColor}, ${store.secondaryColor})` }}
      />

      <div className="flex gap-4 mb-4">
        {images[0] && (
          <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0">
            <img src={images[0]} alt={product.name} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-base leading-tight mb-1">{product.name}</p>
          {product.destination && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 shrink-0" /> {product.destination}
            </p>
          )}
          {startDate && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 shrink-0" /> {fmtDate(startDate)}
            </p>
          )}
          {(() => {
            const dur =
              calculateTripDuration(
                product.departureDate ?? product.startDate,
                product.endDate,
                product.departureTime,
                product.returnTime,
              ) ??
              (product.durationDays
                ? { formatted: `${product.durationDays} dia${product.durationDays > 1 ? "s" : ""}` }
                : null);
            return dur ? (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 shrink-0" /> {dur.formatted}
              </p>
            ) : null;
          })()}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-0.5">Passageiro</p>
          <p className="font-semibold">{customerName}</p>
        </div>
        {seats.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <Armchair className="w-3 h-3" /> Assento(s)
            </p>
            <p className="font-semibold">{seats.join(", ")}</p>
          </div>
        )}
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-0.5">Pagamento</p>
          <p className="font-semibold">{PAYMENT_LABELS[paymentMethod] ?? paymentMethod}</p>
        </div>
        <div className={financialSummary.paidAmount > 0 ? "bg-blue-50 border border-blue-200 rounded-lg p-3" : "bg-green-50 border border-green-200 rounded-lg p-3"}>
          <p className="text-xs text-muted-foreground mb-0.5">
            {financialSummary.paidAmount > 0 ? "Pagamento confirmado" : "Total líquido"}
          </p>
          <p className={financialSummary.paidAmount > 0 ? "font-bold text-blue-700 text-base" : "font-bold text-green-700 text-base"}>
            R$ {(financialSummary.paidAmount > 0 ? financialSummary.paidAmount : financialSummary.totalAmount).toFixed(2)}
          </p>
        </div>
      </div>

      {financialSummary.depositRequested > 0 && financialSummary.amountRemaining > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 space-y-1 text-sm text-amber-800">
          <p className="text-xs font-semibold text-amber-700 mb-1">
            {financialSummary.states.payment === "partially_paid" ? "Pagamento parcial confirmado" : "Entrada mínima solicitada"}
          </p>
          <div className="flex justify-between">
            <span>Valor total do pedido</span>
            <span className="font-semibold">R$ {financialSummary.totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Entrada mínima solicitada</span>
            <span className="font-semibold">R$ {financialSummary.depositRequested.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Pagamento recebido</span>
            <span className="font-semibold">R$ {financialSummary.paidAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-amber-200 pt-1">
            <span className="font-semibold">Restante a pagar</span>
            <span className="font-bold text-amber-900">R$ {financialSummary.amountRemaining.toFixed(2)}</span>
          </div>
          <p className="text-xs text-amber-700 mt-1">
            {financialSummary.reservationValid
              ? "O saldo considera somente pagamentos confirmados."
              : "A entrada solicitada ainda não é um pagamento confirmado."}
          </p>
        </div>
      )}

      {(referralDiscount > 0 || couponDiscount > 0) && (
        <div className="border border-green-200 bg-green-50 rounded-lg px-3 py-2 mb-4 space-y-1 text-sm text-green-800">
          <p className="text-xs font-semibold text-green-700 mb-1">Descontos aplicados</p>
          {referralDiscount > 0 && (
            <div className="flex justify-between">
              <span>
                {referralDiscountType === "percentage" && referralDiscountPct != null
                  ? `Desconto de indicação (${referralDiscountPct}%)`
                  : "Desconto de indicação"}
              </span>
              <span className="font-semibold">− R$ {referralDiscount.toFixed(2)}</span>
            </div>
          )}
          {couponDiscount > 0 && (
            <div className="flex justify-between">
              <span>{couponCode ? `Cupom ${couponCode}` : "Desconto de cupom"}</span>
              <span className="font-semibold">− R$ {couponDiscount.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 border-t pt-4">
        <div className="shrink-0">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code do pedido" className="w-20 h-20 rounded-lg" />
          ) : (
            <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
              <p className="text-[10px] text-muted-foreground">QR Code</p>
            </div>
          )}
        </div>
        <div className="flex-1 text-xs text-muted-foreground leading-relaxed">
          <p>Apresente este voucher no embarque. Em caso de dúvidas, entre em contato com nossa equipe.</p>
          {store.contactWhatsapp && (
            <p className="mt-1 font-medium text-foreground">WhatsApp: {store.contactWhatsapp}</p>
          )}
          {store.contactEmail && (
            <p className="font-medium text-foreground">{store.contactEmail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
