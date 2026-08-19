import { useState, useEffect } from "react";
import QRCodeLib from "qrcode";
import { Wifi, CreditCard, Download, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Reservation } from "@workspace/api-client-react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { formatCurrency as fmtCurrency } from "@/lib/utils";

interface ReservationCardVisualProps {
  reservation: Reservation;
  clientName: string;
  agencyName: string;
  agencyLogo?: string | null;
  departureDate: string;
  onViewVoucher?: () => void;
  onDownloadPdf?: () => void;
}

function parseReservationNumber(rn: string | null | undefined) {
  if (!rn) return { prefix: "—", typeCode: "—", yearMonth: "—", sequenceStr: "—" };
  const parts = rn.split("-");
  return {
    prefix: parts[0] ?? "—",
    typeCode: parts[1] ?? "—",
    yearMonth: parts[2] ?? "—",
    sequenceStr: parts[3] ?? "—",
  };
}

function getTypeName(typeCode: string) {
  const map: Record<string, string> = {
    EXC: "Excursão",
    PCT: "Pacote",
    BTV: "Bate-volta",
    RES: "Reserva",
    TRF: "Transfer",
  };
  return map[typeCode] ?? typeCode;
}

function getStatusColor(status: string) {
  if (status === RESERVATION_STATUS.CONFIRMED) return "bg-green-500";
  if (status === RESERVATION_STATUS.CANCELLED) return "bg-red-500";
  return "bg-yellow-400";
}

function getStatusLabel(status: string) {
  if (status === RESERVATION_STATUS.CONFIRMED) return "Confirmada";
  if (status === RESERVATION_STATUS.CANCELLED) return "Cancelada";
  return "Pendente";
}

function getPaymentLabel(balance: number) {
  if (balance <= 0) return "Pago";
  return "Pendente";
}

function formatYearMonth(ym: string) {
  if (!ym || ym === "—") return ym;
  const year = ym.substring(0, 4);
  const month = ym.substring(4, 6);
  return `${month}/${year}`;
}

export function ReservationCardVisual({
  reservation,
  clientName,
  agencyName,
  agencyLogo,
  departureDate,
  onViewVoucher,
  onDownloadPdf,
}: ReservationCardVisualProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const { prefix, typeCode, yearMonth, sequenceStr } = parseReservationNumber(reservation.reservationNumber);

  const cardNumber = reservation.reservationNumber
    ? `1234  ${yearMonth}-${sequenceStr}  3456`
    : `1234  ${reservation.voucherCode.slice(0, 8)}  3456`;

  const clientCpf = reservation.client.cpf;
  const destination = reservation.trip.destination;
  const firstSeat = reservation.seats?.[0] ?? "—";
  const status = reservation.status;

  useEffect(() => {
    const code = reservation.voucherCode || reservation.id;
    if (code) {
      QRCodeLib.toDataURL(code, { width: 128, margin: 1 })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [reservation.voucherCode, reservation.id]);

  return (
    <div className="w-full max-w-[480px] mx-auto select-none">
      {/* Card Container with 3D perspective */}
      <div className="perspective-1000">
        <div
          className={`relative w-full transform-style-3d transition-all duration-700 cursor-pointer ${isFlipped ? "rotate-y-180" : ""}`}
          style={{ aspectRatio: "1.586 / 1" }}
          onClick={() => setIsFlipped((f) => !f)}
        >
          {/* ─────────────────── FRONT ─────────────────── */}
          <div
            className="absolute inset-0 backface-hidden rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 45%, #1a1a2e 100%)",
              boxShadow: "0 30px 60px -12px rgba(0,0,0,0.6), 0 0 50px rgba(102,126,234,0.25)",
              transform: "rotateX(4deg) rotateY(-3deg)",
            }}
          >
            {/* Background glow effects */}
            <div className="absolute inset-0 pointer-events-none">
              <div
                className="absolute top-0 right-0 w-72 h-72 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)",
                  transform: "translate(30%, -30%)",
                }}
              />
              <div
                className="absolute bottom-0 left-0 w-48 h-48 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(167,139,250,0.25) 0%, transparent 70%)",
                  transform: "translate(-30%, 30%)",
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.06) 50%, transparent 60%)",
                }}
              />
            </div>

            <div className="relative z-10 h-full p-5 flex flex-col justify-between text-white">
              {/* Header: Agency + NFC */}
              <div className="flex items-start justify-between">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2.5 cursor-help">
                        {agencyLogo ? (
                          <img
                            src={agencyLogo}
                            alt={agencyName}
                            className="w-10 h-10 rounded-lg object-contain bg-white/20 p-1"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center">
                            <CreditCard className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <p className="text-xl font-black tracking-widest leading-none">
                            {prefix !== "—" ? prefix : agencyName.substring(0, 3).toUpperCase()}
                          </p>
                          <p className="text-[10px] opacity-75 leading-tight">{agencyName}</p>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="bg-gray-900 text-white border-gray-700">
                      <p className="font-semibold text-xs">Prefixo da Agência (3 letras)</p>
                      <p className="text-[10px] opacity-70">Identifica a origem da reserva</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* NFC + status dot */}
                <div className="flex flex-col items-end gap-1.5">
                  <Wifi className="w-6 h-6 rotate-90 opacity-75" />
                  <div
                    className={`w-2.5 h-2.5 rounded-full animate-pulse ${getStatusColor(status)}`}
                    title={getStatusLabel(status)}
                  />
                </div>
              </div>

              {/* EMV Chip */}
              <div className="absolute left-5 top-[72px]">
                <div
                  className="w-12 h-9 rounded-md shadow-lg overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, #f6d365 0%, #c9a227 40%, #e8c547 70%, #a07d12 100%)",
                  }}
                >
                  <div className="w-full h-full p-1">
                    <div className="grid grid-cols-4 gap-px h-full">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded-sm"
                          style={{ background: "rgba(160,125,18,0.5)" }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Number */}
              <div className="mt-10">
                <div
                  className="rounded-lg p-2.5 mb-1"
                  style={{ background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)" }}
                >
                  <p className="font-mono text-lg font-bold tracking-[0.25em] text-center">
                    {cardNumber}
                  </p>
                </div>
                <p className="text-[10px] text-center opacity-60">
                  {reservation.reservationNumber
                    ? `${formatYearMonth(yearMonth)} · Seq. ${sequenceStr}`
                    : "Código da Reserva"}
                </p>
              </div>

              {/* Type code — right edge */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="absolute right-4 top-1/2 cursor-help"
                      style={{ transform: "translateY(-50%) rotate(90deg)" }}
                    >
                      <div
                        className="px-3 py-1 rounded-full"
                        style={{ background: "rgba(255,255,255,0.18)", backdropFilter: "blur(4px)" }}
                      >
                        <p className="text-base font-black tracking-widest">
                          {typeCode !== "—" ? typeCode : (reservation.tripType?.substring(0, 3).toUpperCase() ?? "RES")}
                        </p>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="bg-gray-900 text-white border-gray-700">
                    <p className="font-semibold text-xs">Tipo (EXC/PCT/BTV)</p>
                    <p className="text-[10px] opacity-70">
                      {getTypeName(typeCode !== "—" ? typeCode : (reservation.tripType?.toUpperCase() ?? "RES"))}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Bottom info: client name + trip details */}
              <div className="space-y-1.5">
                <div>
                  <p className="text-[9px] opacity-60 uppercase tracking-widest">Titular</p>
                  <p className="text-sm font-bold uppercase tracking-wide truncate pr-10">
                    {clientName}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <p className="text-[9px] opacity-60 uppercase tracking-wider">Destino</p>
                    <p className="text-xs font-semibold truncate">{destination}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] opacity-60 uppercase tracking-wider">Assento</p>
                    <p className="text-lg font-black leading-none">{firstSeat}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] opacity-60 uppercase tracking-wider">Saída</p>
                    <p className="text-xs font-semibold">{departureDate}</p>
                  </div>
                </div>
              </div>

              {/* Bottom-right brand mark */}
              <div className="absolute bottom-5 right-5">
                <div
                  className="w-10 h-7 rounded flex items-center justify-center opacity-75"
                  style={{
                    background: "linear-gradient(135deg, #b0b8c8, #8898aa)",
                  }}
                >
                  <span className="text-[9px] font-black text-gray-700 tracking-widest">VCM</span>
                </div>
              </div>

              {/* Holographic hover sheen */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                  background: "linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.07) 50%, transparent 70%)",
                }}
              />
            </div>
          </div>

          {/* ─────────────────── BACK ─────────────────── */}
          <div
            className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #764ba2 55%, #667eea 100%)",
              boxShadow: "0 30px 60px -12px rgba(0,0,0,0.6)",
            }}
          >
            {/* Magnetic strip */}
            <div className="w-full h-10 bg-black mt-6" />

            <div className="px-5 pb-5 pt-3 flex items-start gap-4 text-white h-[calc(100%-64px)]">
              {/* QR Code */}
              <div className="bg-white rounded-lg p-2 shrink-0 self-center">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR de verificação" className="w-24 h-24" />
                ) : (
                  <div className="w-24 h-24 bg-gray-100 rounded flex items-center justify-center">
                    <span className="text-[10px] text-gray-400">QR</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-2">
                {reservation.reservationNumber && (
                  <div>
                    <p className="text-[10px] opacity-60 uppercase tracking-wider">Nº Reserva</p>
                    <p className="font-mono text-sm font-black">{reservation.reservationNumber}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] opacity-60 uppercase tracking-wider">Voucher</p>
                  <p className="font-mono text-xs font-bold">{reservation.voucherCode}</p>
                </div>
                {clientCpf && (
                  <div>
                    <p className="text-[10px] opacity-60 uppercase tracking-wider">CPF</p>
                    <p className="font-mono text-xs">{clientCpf}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <p className="text-[10px] opacity-60 uppercase tracking-wider">Total</p>
                    <p className="text-sm font-bold text-green-300">{fmtCurrency(reservation.totalValue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] opacity-60 uppercase tracking-wider">Pago</p>
                    <p className="text-sm font-bold text-blue-300">{fmtCurrency(reservation.paidValue)}</p>
                  </div>
                </div>
                {reservation.balance > 0 && (
                  <div>
                    <p className="text-[10px] opacity-60 uppercase tracking-wider">Saldo</p>
                    <p className="text-sm font-bold text-orange-300">{fmtCurrency(reservation.balance)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Instructions */}
            <div className="absolute bottom-3 left-5 right-5 text-[10px] text-white/50 space-y-0.5">
              <p>✓ Apresente este cartão no embarque</p>
              <p>✓ Escaneie o QR Code para validação</p>
            </div>
          </div>
        </div>
      </div>

      {/* Info strip below card */}
      <div className="mt-4 flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(status)}`} />
          <span className="text-sm font-medium">{getStatusLabel(status)}</span>
        </div>
        <Badge variant={reservation.balance <= 0 ? "default" : "secondary"} className="text-xs">
          {getPaymentLabel(reservation.balance)}
        </Badge>
      </div>

      {/* Actions */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); onDownloadPdf?.(); }}>
          <Download className="w-4 h-4 mr-1.5" />
          Baixar Voucher
        </Button>
        <Button variant="outline" size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); onViewVoucher?.(); }}>
          <RotateCcw className="w-4 h-4 mr-1.5" />
          Ver Detalhes
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-2">
        💳 Clique no cartão para ver o verso
      </p>
    </div>
  );
}
