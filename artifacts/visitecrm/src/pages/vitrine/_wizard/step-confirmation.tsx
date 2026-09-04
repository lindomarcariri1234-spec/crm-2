import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Ticket,
  MapPin,
  Users,
  CreditCard,
  Info,
  Printer,
  MessageSquare,
  Search,
  Mail,
  Phone,
  UserCircle,
  Copy,
  Check,
} from "lucide-react";
import { PublicStore } from "@/lib/storeApi";
import { calculateTripDuration } from "@/lib/tripDuration";
import { StepIndicator } from "./step-indicator";
import { ConfettiAnimation } from "./confetti";
import { Voucher } from "./voucher";
import { fmtDateLong, PAYMENT_LABELS } from "./constants";
import type { WizardState } from "./use-wizard-state";

function PixPaymentBlock({
  pixQrCodeUrl,
  pixCopyPaste,
  primaryColor,
}: {
  pixQrCodeUrl: string;
  pixCopyPaste: string;
  primaryColor?: string;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(pixCopyPaste).then(() => {
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
            src={pixQrCodeUrl}
            alt="QR Code PIX"
            className="w-48 h-48 rounded-lg border border-teal-300 bg-white p-1"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <div className="flex-1 space-y-3 text-sm">
          <p className="text-teal-800">
            Escaneie o QR Code com o aplicativo do seu banco ou copie o código abaixo
            para pagar via <strong>Pix Copia e Cola</strong>.
          </p>
          <div className="bg-white border border-teal-200 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1 font-medium">Código Pix Copia e Cola</p>
            <p className="font-mono text-xs break-all text-gray-700 leading-relaxed select-all">
              {pixCopyPaste}
            </p>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: primaryColor ?? "#0d9488" }}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copiado!" : "Copiar código PIX"}
          </button>
          <p className="text-xs text-teal-700 flex items-start gap-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Após o pagamento, envie o comprovante para a agência para confirmar sua reserva.
          </p>
        </div>
      </div>
    </div>
  );
}

export function StepConfirmation({
  state,
  store,
  slug,
}: {
  state: WizardState;
  store: PublicStore;
  slug: string;
}) {
  const {
    product,
    completedOrder,
    showConfetti,
    expiryCountdown,
    qty,
    effectiveSeats,
    form,
    navigate,
    referralDiscount,
    referralApplied,
    referralDiscountType,
    referralDiscountPct,
    couponDiscount,
    couponResult,
    selectedBoardingPointId,
  } = state;
  if (!product || !completedOrder) return null;
  const summary = completedOrder.financialSummary;
  const totalAmt = summary.totalAmount;
  const depositAmt = summary.depositRequested > 0 ? summary.depositRequested : null;
  const paidAmt = summary.paidAmount;
  const isFullyPaid = summary.states.payment === "paid";
  const isPartiallyPaid = summary.states.payment === "partially_paid";
  const reservationValid = summary.reservationValid;
  const remainingAmt = summary.amountRemaining;
  const startDate = product.departureDate ?? product.startDate;
  const boardingPoints = (product.boardingPoints ?? []).filter((bp) => bp.name);
  const selectedBoardingPoint =
    boardingPoints.length === 1
      ? boardingPoints[0]
      : boardingPoints.find((bp) => bp.id === selectedBoardingPointId) ?? null;

  function handlePrint() {
    window.print();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 pb-20">
      {showConfetti && <ConfettiAnimation />}

      <StepIndicator current="confirmado" />

      <div className="space-y-6">
        <div
          className="rounded-2xl p-8 text-center border"
          style={{
            background: `linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)`,
            borderColor: "#bbf7d0",
          }}
        >
          <div className="flex justify-center mb-4">
            <div className="bg-green-500 rounded-full p-4">
              <CheckCircle2 className="w-14 h-14 text-white" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-green-900 mb-2">
            {reservationValid
              ? "Reserva Confirmada! 🎉"
              : isPartiallyPaid
                ? "Pagamento Parcial Recebido"
                : "Pedido Realizado! 🎉"}
          </h2>
          <p className="text-lg text-green-800 mb-6">
            {reservationValid
              ? "Seu pagamento foi confirmado e a reserva está válida."
              : isPartiallyPaid
                ? "Uma parte do pagamento foi confirmada. A reserva ainda aguarda atingir o mínimo exigido e ser confirmada."
                : form.paymentMethod === "pix"
                  ? "Seu pedido foi criado! Complete o pagamento via PIX para confirmar sua reserva."
                  : "Seu pedido foi criado. Confirme o pagamento para validar a reserva."}
          </p>
          <div className="inline-flex items-center gap-2 bg-white px-6 py-3 rounded-xl shadow-sm border border-green-200">
            <Ticket className="w-5 h-5 text-green-600" />
            <div className="text-left">
              <p className="text-xs text-muted-foreground">Número do Pedido</p>
              <p className="text-2xl font-bold text-green-600 font-mono">
                {completedOrder.orderNumber}
              </p>
            </div>
          </div>
          {expiryCountdown !== null && (
            <div className="mt-4 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="text-sm">
                Conclua o pagamento em{" "}
                <strong className="font-mono text-base">{expiryCountdown}</strong> ou a reserva será
                cancelada automaticamente.
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border rounded-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Detalhes da Viagem
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Viagem</p>
                <p className="font-semibold">{product.name}</p>
                {product.destination && (
                  <p className="text-muted-foreground">📍 {product.destination}</p>
                )}
              </div>
              {startDate && (
                <div>
                  <p className="text-muted-foreground text-xs">Data de Saída</p>
                  <p className="font-semibold">{fmtDateLong(startDate)}</p>
                </div>
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
                    ? {
                        formatted: `${product.durationDays} ${product.durationDays === 1 ? "dia" : "dias"}`,
                      }
                    : null);
                return dur ? (
                  <div>
                    <p className="text-muted-foreground text-xs">Duração</p>
                    <p className="font-semibold">{dur.formatted}</p>
                  </div>
                ) : null;
              })()}
              <div>
                <p className="text-muted-foreground text-xs">Passageiros</p>
                <p className="font-semibold">
                  {qty} passageiro{qty !== 1 ? "s" : ""}
                </p>
              </div>
              {effectiveSeats.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Assentos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {effectiveSeats.map((s) => (
                      <span
                        key={s}
                        className="px-2.5 py-1 rounded-full text-white text-xs font-semibold"
                        style={{ backgroundColor: store.accentColor || store.primaryColor }}
                      >
                        Assento {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selectedBoardingPoint && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Ponto de Embarque</p>
                  <div className="flex items-start gap-1.5 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold text-blue-900">{selectedBoardingPoint.name}</p>
                      {selectedBoardingPoint.time && (
                        <p className="text-blue-700 text-xs mt-0.5">🕐 {selectedBoardingPoint.time}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border rounded-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-600" />
              Suas Informações
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Nome</p>
                <p className="font-semibold">{form.customerName}</p>
              </div>
              {form.customerCpf && (
                <div>
                  <p className="text-muted-foreground text-xs">CPF</p>
                  <p className="font-semibold">{form.customerCpf}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs">Email</p>
                <p className="font-semibold">{form.customerEmail}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Telefone</p>
                <p className="font-semibold">{form.customerPhone}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Número do Pedido</p>
                <div className="mt-1">
                  <span
                    className="px-3 py-1.5 rounded-lg text-white text-sm font-mono font-bold"
                    style={{ backgroundColor: store.primaryColor }}
                  >
                    {completedOrder.orderNumber}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border rounded-2xl p-6">
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-green-600" />
            Resumo Financeiro
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <p className="text-xs text-muted-foreground mb-1">Valor Total</p>
              <p className="text-2xl font-bold text-gray-900">R$ {totalAmt.toFixed(2)}</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl">
              <p className="text-xs text-muted-foreground mb-1">Pagamento Recebido</p>
              <p className="text-2xl font-bold text-green-600">
                R$ {paidAmt.toFixed(2)}
              </p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-xl">
              <p className="text-xs text-muted-foreground mb-1">Saldo Pendente</p>
              <p className="text-2xl font-bold text-orange-600">
                R$ {remainingAmt !== null ? remainingAmt.toFixed(2) : totalAmt.toFixed(2)}
              </p>
            </div>
          </div>
          {depositAmt !== null && depositAmt < totalAmt && (
            <div className="flex justify-between text-sm border-t pt-3 mb-4">
              <span className="text-muted-foreground">Entrada solicitada</span>
              <span className="font-semibold text-amber-700">R$ {depositAmt.toFixed(2)}</span>
            </div>
          )}
          {(referralApplied && referralDiscount > 0) || couponDiscount > 0 ? (
            <div className="space-y-1 text-sm text-green-700 border border-green-200 bg-green-50 rounded-xl px-4 py-3">
              {referralApplied && referralDiscount > 0 && (
                <div className="flex justify-between">
                  <span>
                    {referralDiscountType === "percentage"
                      ? `Desconto de indicação (${referralDiscountPct}%)`
                      : "Desconto de indicação"}
                  </span>
                  <span className="font-semibold">− R$ {referralDiscount.toFixed(2)}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="flex justify-between">
                  <span>
                    {couponResult?.code
                      ? `Cupom ${couponResult.code}`
                      : "Desconto de cupom"}
                  </span>
                  <span className="font-semibold">− R$ {couponDiscount.toFixed(2)}</span>
                </div>
              )}
            </div>
          ) : null}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900">
            <p>
              <strong>Forma de Pagamento:</strong>{" "}
              {PAYMENT_LABELS[form.paymentMethod] ?? form.paymentMethod}
            </p>
            {(!completedOrder.pixQrCode || !completedOrder.pixQrCodeUrl) && (
              <p className="mt-1.5 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                Aguardando confirmação do pagamento. Você receberá um email assim que o pagamento for
                confirmado.
              </p>
            )}
          </div>
          {completedOrder.pixQrCode && completedOrder.pixQrCodeUrl && (
            <PixPaymentBlock
              pixQrCodeUrl={completedOrder.pixQrCodeUrl}
              pixCopyPaste={completedOrder.pixCopyPaste ?? completedOrder.pixQrCode}
              primaryColor={store.primaryColor}
            />
          )}
        </div>

        <div className="border rounded-2xl p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <h3 className="text-lg font-bold mb-4">📋 Próximos Passos</h3>
          <div className="space-y-3">
            {(form.paymentMethod === "pix"
              ? [
                  "Realize o pagamento via PIX usando o QR Code ou o código Copia e Cola acima.",
                  "Após o pagamento, envie o comprovante para a agência pelo WhatsApp para agilizar a confirmação.",
                  "A agência irá verificar o pagamento e confirmar sua reserva. Você receberá um e-mail de confirmação.",
                  "Apresente o voucher e documento com foto no dia do embarque.",
                ]
              : [
                  "Você receberá um email de confirmação com todos os detalhes da sua reserva e o voucher em anexo.",
                  "Também enviaremos uma mensagem no WhatsApp com as informações de embarque.",
                  "Apresente o voucher e documento com foto no dia do embarque.",
                  "Chegue ao ponto de embarque com 30 minutos de antecedência.",
                ]
            ).map((stepText, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <div
                  className="text-white rounded-full w-6 h-6 flex items-center justify-center shrink-0 font-bold text-sm"
                  style={{ backgroundColor: store.primaryColor }}
                >
                  {idx + 1}
                </div>
                <p className="text-gray-700 text-sm">{stepText}</p>
              </div>
            ))}
          </div>
        </div>

          <Voucher
          order={completedOrder}
          product={product}
          store={store}
          customerName={form.customerName}
          seats={effectiveSeats}
          paymentMethod={form.paymentMethod}
          referralDiscount={referralApplied ? referralDiscount : 0}
          referralDiscountType={referralDiscountType}
          referralDiscountPct={referralDiscountPct}
          couponDiscount={couponDiscount}
          couponCode={couponResult?.code}
          financialSummary={summary}
        />

        <div className="rounded-2xl p-6 text-center border-2 print:hidden"
          style={{ borderColor: store.primaryColor + "40", background: `${store.primaryColor}08` }}
        >
          <div className="flex justify-center mb-3">
            <div
              className="rounded-full p-3"
              style={{ backgroundColor: store.primaryColor + "20" }}
            >
              <UserCircle className="w-8 h-8" style={{ color: store.primaryColor }} />
            </div>
          </div>
          <h3 className="text-lg font-bold mb-1">Acompanhe sua reserva</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Acesse sua Área do Cliente para ver vouchers, pagamentos e todas as suas viagens.
          </p>
          <Button
            onClick={() => navigate("/perfil")}
            className="text-white font-semibold px-8"
            style={{ backgroundColor: store.primaryColor }}
          >
            <UserCircle className="w-4 h-4 mr-2" />
            Acessar Meu Perfil
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Use o e-mail e a senha enviados para <strong>{form.customerEmail}</strong>
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center print:hidden">
          <Button onClick={handlePrint} variant="outline" className="flex items-center gap-2">
            <Printer className="w-4 h-4" />
            Imprimir / Salvar Voucher
          </Button>
          {store.contactWhatsapp && (
            <Button
              onClick={() => {
                const phone = store.contactWhatsapp!.replace(/\D/g, "");
                const msg = `Olá! Acabei de fazer uma reserva (${completedOrder.orderNumber}) para a viagem ${product.name}. Gostaria de mais informações.`;
                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
              }}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              <MessageSquare className="w-4 h-4" />
              Falar no WhatsApp
            </Button>
          )}
          <Button
            onClick={() => navigate(`/loja/${slug}/consultar-pedido`)}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Consultar Pedido
          </Button>
          <Button
            onClick={() => navigate(`/loja/${slug}/produtos`)}
            style={{ backgroundColor: store.primaryColor }}
            className="text-white flex items-center gap-2"
          >
            Ver mais pacotes
          </Button>
        </div>

        {(store.contactWhatsapp || store.contactEmail || store.contactPhone) && (
          <div className="border rounded-2xl p-6 bg-gray-50 print:hidden">
            <h3 className="text-lg font-bold mb-3">📞 Precisa de Ajuda?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Nossa equipe está pronta para atendê-lo!
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {store.contactWhatsapp && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-green-600 shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">WhatsApp</p>
                    <p className="font-semibold">{store.contactWhatsapp}</p>
                  </div>
                </div>
              )}
              {store.contactEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Email</p>
                    <p className="font-semibold">{store.contactEmail}</p>
                  </div>
                </div>
              )}
              {store.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-600 shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs">Telefone</p>
                    <p className="font-semibold">{store.contactPhone}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
