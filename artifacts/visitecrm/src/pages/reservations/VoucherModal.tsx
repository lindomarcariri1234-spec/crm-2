import { useState, useEffect, useRef, useCallback } from "react";
import { useGetReservation } from "@workspace/api-client-react";
import type { Reservation } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Printer } from "lucide-react";
import QRCodeLib from "qrcode";
import { STATUS_COLORS, STATUS_LABELS, fmt } from "./constants";
import { formatDate } from "@/lib/utils";

function VoucherContent({ r, qrDataUrl }: { r: Reservation | null | undefined; qrDataUrl: string }) {
  const trip = r?.trip;
  const client = r?.client;
  return (
    <div className="bg-white text-gray-900 font-sans" style={{ fontFamily: "system-ui, Arial, sans-serif" }}>
      <div className="flex items-center justify-between pb-3 border-b-2 border-gray-800 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white font-black text-sm">V</div>
          <div>
            <p className="font-black text-sm text-gray-900 leading-none">VisiteCRM</p>
            <p className="text-xs text-gray-500 leading-none">Gestão de Agência de Turismo</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Voucher de Viagem</p>
          <p className="text-xs text-gray-400">{new Date(r?.createdAt ?? "").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5 py-4 mb-4 bg-gray-50 rounded-lg border border-gray-200">
        {r?.reservationNumber ? (
          <>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">Número da Reserva</p>
            <p className="text-2xl font-mono font-black tracking-wider text-gray-900">{r.reservationNumber}</p>
            <p className="text-xs text-gray-400 font-mono">Código: {r?.voucherCode}</p>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">Código do Voucher</p>
            <p className="text-3xl font-mono font-black tracking-wider text-gray-900">{r?.voucherCode}</p>
          </>
        )}
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[r?.status ?? ""] ?? "bg-gray-100 text-gray-800"}`}>
          {STATUS_LABELS[r?.status ?? ""] ?? r?.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Passageiro</p>
          <p className="font-bold text-sm text-gray-900">{client?.name ?? "—"}</p>
          {client?.whatsapp && <p className="text-xs text-gray-500">{client.whatsapp}</p>}
          {client?.cpf && <p className="text-xs text-gray-500">CPF: {client.cpf}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Viagem</p>
          <p className="font-bold text-sm text-gray-900">{trip?.name ?? "—"}</p>
          {trip?.destination && <p className="text-xs text-gray-500">{trip.destination}</p>}
          {trip?.departureDate && (
            <p className="text-xs text-gray-500">Partida: {formatDate(trip.departureDate)}</p>
          )}
        </div>
      </div>

      {r?.boardingLocation && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Ponto de Embarque</p>
          <p className="font-bold text-sm text-gray-900">{r.boardingLocation.name}</p>
          {r.boardingLocation.time && (
            <p className="text-xs text-gray-500">Horário: {r.boardingLocation.time}</p>
          )}
        </div>
      )}

      {(r?.seats?.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Assentos</p>
          <div className="flex flex-wrap gap-1">
            {r!.seats.map(s => {
              const isBrazilian = trip?.numberingType?.includes("brazilian_standard") ?? false;
              const num = isBrazilian ? parseInt(s.replace(/\D/g, ""), 10) : NaN;
              const position = isBrazilian && !isNaN(num) ? (num % 2 !== 0 ? " (Janela)" : " (Corredor)") : "";
              return (
                <span key={s} className="font-mono text-xs bg-gray-100 border border-gray-300 text-gray-800 px-2 py-1 rounded font-bold">
                  {s}{position}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-dashed border-gray-300 pt-3 mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Resumo Financeiro</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded p-2">
            <p className="text-xs text-gray-500 mb-0.5">Total</p>
            <p className="font-bold text-sm text-gray-900">{fmt(r?.totalValue ?? 0)}</p>
          </div>
          <div className="bg-green-50 rounded p-2">
            <p className="text-xs text-gray-500 mb-0.5">Pago</p>
            <p className="font-bold text-sm text-green-700">{fmt(r?.paidValue ?? 0)}</p>
          </div>
          <div className={`rounded p-2 ${(r?.balance ?? 0) > 0 ? "bg-red-50" : "bg-green-50"}`}>
            <p className="text-xs text-gray-500 mb-0.5">Saldo</p>
            <p className={`font-bold text-sm ${(r?.balance ?? 0) > 0 ? "text-red-600" : "text-green-700"}`}>{fmt(r?.balance ?? 0)}</p>
          </div>
        </div>
      </div>

      {qrDataUrl && (
        <div className="flex flex-col items-center gap-1.5 border-t border-dashed border-gray-300 pt-3 mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Verificação</p>
          <img src={qrDataUrl} alt="QR Code de verificação" className="w-24 h-24" />
          <p className="text-xs text-gray-400">Aponte a câmera para verificar o voucher</p>
        </div>
      )}

      <div className="border-t border-gray-200 pt-2 text-center">
        <p className="text-xs text-gray-400">
          Emitido em {new Date(r?.createdAt ?? "").toLocaleString("pt-BR")} · Este voucher é válido mediante apresentação de documento de identidade.
        </p>
      </div>
    </div>
  );
}

export function VoucherModal({ reservation, open, onClose, autoDownload }: {
  reservation: Reservation | null;
  open: boolean;
  onClose: () => void;
  autoDownload?: boolean;
}) {
  const reservationId = reservation?.id ?? "";
  const { data: fullData, isLoading } = useGetReservation(reservationId, {
    query: { queryKey: ["voucher", reservationId], enabled: open && !!reservationId },
  });
  const r = fullData ?? reservation;
  const voucherRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const hasAutoDownloaded = useRef(false);

  useEffect(() => {
    const code = r?.voucherCode ?? r?.id ?? "";
    if (code) {
      QRCodeLib.toDataURL(code, { width: 112, margin: 1 })
        .then(url => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [r?.voucherCode, r?.id]);

  const handleDownloadPDF = useCallback(async () => {
    if (!voucherRef.current) return;
    setIsGeneratingPdf(true);
    try {
      const [html2canvas, { default: jsPDF }] = await Promise.all([
        import("html2canvas").then(m => m.default),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(voucherRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`voucher-${r?.voucherCode ?? reservationId}.pdf`);
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [r?.voucherCode, reservationId]);

  useEffect(() => {
    if (autoDownload && open && !isLoading && r && qrDataUrl && !hasAutoDownloaded.current) {
      hasAutoDownloaded.current = true;
      setTimeout(() => handleDownloadPDF(), 100);
    }
    if (!open) {
      hasAutoDownloaded.current = false;
    }
  }, [autoDownload, open, isLoading, r, qrDataUrl, handleDownloadPDF]);

  const handlePrint = useCallback(() => {
    if (!voucherRef.current) { window.print(); return; }
    const printEl = document.createElement("div");
    printEl.setAttribute("data-voucher-print", "true");
    printEl.style.cssText = "display:none;position:fixed;inset:0;background:white;z-index:99999;padding:20mm;box-sizing:border-box;";
    printEl.appendChild(voucherRef.current.cloneNode(true));
    document.body.appendChild(printEl);
    const styleEl = document.createElement("style");
    styleEl.textContent = `@media print { body > *:not([data-voucher-print]) { display: none !important; } [data-voucher-print] { display: block !important; } }`;
    document.head.appendChild(styleEl);
    const cleanup = () => {
      if (document.body.contains(printEl)) document.body.removeChild(printEl);
      if (document.head.contains(styleEl)) document.head.removeChild(styleEl);
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 3000);
  }, []);

  if (!reservation) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Voucher de Reserva</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <div ref={voucherRef} className="bg-white p-4 rounded-lg border">
              <VoucherContent r={r} qrDataUrl={qrDataUrl} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={handlePrint} disabled={isGeneratingPdf}>
                <Printer className="mr-2 h-4 w-4" />Imprimir
              </Button>
              <Button className="flex-1" onClick={handleDownloadPDF} disabled={isGeneratingPdf}>
                <Download className="mr-2 h-4 w-4" />
                {isGeneratingPdf ? "Gerando..." : "Baixar PDF"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
