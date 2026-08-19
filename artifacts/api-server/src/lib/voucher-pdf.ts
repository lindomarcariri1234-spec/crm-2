import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRLPlain as fmtCurrencyPt } from "@workspace/shared";

applyPlugin(jsPDF);

type JsPDFWithAutoTable = InstanceType<typeof jsPDF> & {
  autoTable: (opts: Record<string, unknown>) => void;
  lastAutoTable: { finalY: number };
};

export interface VoucherData {
  passengerName: string;
  agencyName: string;
  primaryColor: string;
  reservationId: string;
  reservationNumber: string | null;
  status: string;
  voucherCode: string | null;
  reservationDate: Date;
  paymentMethod: string | null;
  totalValue: number;
  paidValue: number;
  balance: number;
  seatsCount: number;
  /** Número de passageiros de colo (ageCategory="baby" sem poltrona). */
  lapChildCount?: number;
  tripName: string;
  tripDestination: string;
  tripDepartureDate: string | null;
  tripReturnDate: string | null;
  boardingPointName?: string | null;
  boardingPointTime?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando",
  confirmed: "Confirmado",
  completed: "Concluído",
  cancelled: "Cancelado",
  processing: "Processando",
};

function fmtDatePt(dateStr: string | null | undefined): string {
  if (!dateStr) return "A confirmar";
  try {
    return format(new Date(dateStr + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return dateStr;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) || 59;
  const g = parseInt(clean.substring(2, 4), 16) || 130;
  const b = parseInt(clean.substring(4, 6), 16) || 246;
  return [r, g, b];
}

/**
 * Generates a PDF voucher (comprovante de reserva) for a passenger.
 *
 * ## Callers (audit — keep this list up to date)
 * - `routes/client-portal.ts` → GET /client/reservations/:id/voucher
 *   This is currently the **only** caller. The pdf.worker.ts "voucher" job
 *   type only logs an audit entry and does NOT call this function.
 *
 * ## lapChildCount — required query
 * Any new route that calls this function MUST compute `lapChildCount` from
 * the `passengersTable` before invoking `generateVoucherPdf`. The field
 * counts passengers with `ageCategory = "baby"` AND no `seatNumber` (i.e.
 * lap children who travel without a seat). Omitting this query silently
 * drops the "Passageiro(s) no colo" line from the printed voucher.
 *
 * Example query (copy to new callers):
 * ```ts
 * const passengers = await db
 *   .select({ ageCategory: passengersTable.ageCategory, seatNumber: passengersTable.seatNumber })
 *   .from(passengersTable)
 *   .where(eq(passengersTable.reservationId, reservationId));
 * const lapChildCount = passengers.filter(p => p.ageCategory === "baby" && !p.seatNumber).length;
 * // then pass: lapChildCount: lapChildCount > 0 ? lapChildCount : undefined
 * ```
 */
export function generateVoucherPdf(data: VoucherData): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as JsPDFWithAutoTable;

  const [pr, pg, pb] = hexToRgb(data.primaryColor);

  doc.setFillColor(pr, pg, pb);
  doc.rect(0, 0, 210, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("COMPROVANTE DE RESERVA", 14, 14);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(data.agencyName, 14, 21);
  doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`, 14, 27);

  doc.setTextColor(0, 0, 0);

  let y = 44;

  doc.setFillColor(248, 248, 248);
  doc.rect(14, y - 5, 182, 24, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Passageiro", 18, y + 1);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(data.passengerName, 18, y + 9);
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Situação: ${STATUS_LABELS[data.status] ?? data.status}`, 18, y + 16);
  doc.setTextColor(0, 0, 0);

  y += 32;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Dados da Viagem", 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [],
    body: [
      ["Viagem", data.tripName],
      ["Destino", data.tripDestination],
      ["Data de Partida", fmtDatePt(data.tripDepartureDate)],
      ...(data.tripReturnDate ? [["Data de Retorno", fmtDatePt(data.tripReturnDate)]] : []),
      ...(data.boardingPointName
        ? [["Ponto de Embarque", data.boardingPointTime
            ? `${data.boardingPointName} — ${data.boardingPointTime}`
            : data.boardingPointName]]
        : []),
      ["Passageiros", data.seatsCount > 0 ? String(data.seatsCount) : "1"],
      ...(data.lapChildCount && data.lapChildCount > 0
        ? [["Passageiro(s) no colo", data.lapChildCount === 1 ? "1 (sem poltrona)" : `${data.lapChildCount} (sem poltrona)`]]
        : []),
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [80, 80, 80] },
      1: { cellWidth: 130 },
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Dados da Reserva", 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [],
    body: [
      ...(data.reservationNumber ? [["Nº da Reserva", data.reservationNumber]] : []),
      ["Código do Voucher", data.voucherCode ?? "—"],
      ["Data da Reserva", format(data.reservationDate, "dd/MM/yyyy", { locale: ptBR })],
      ...(data.paymentMethod ? [["Forma de Pagamento", data.paymentMethod]] : []),
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [80, 80, 80] },
      1: { cellWidth: 130, fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Valores", 14, y);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [],
    body: [
      ["Valor Total", fmtCurrencyPt(data.totalValue)],
      ["Valor Pago", fmtCurrencyPt(data.paidValue)],
      ...(data.balance > 0 ? [["Saldo Pendente", fmtCurrencyPt(data.balance)]] : []),
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 50, textColor: [80, 80, 80] },
      1: { cellWidth: 130, fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 14;

  doc.setDrawColor(220, 220, 220);
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(140, 140, 140);
  doc.text(
    "Este comprovante é válido como documento de confirmação de reserva. Apresente-o no embarque.",
    14,
    y,
  );

  return Buffer.from(doc.output("arraybuffer"));
}
