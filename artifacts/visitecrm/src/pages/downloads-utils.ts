/**
 * downloads-utils.ts
 *
 * Pure helper functions for the Downloads page.
 * Kept separate so they can be unit-tested without mounting the full React component.
 */
import { format, parseISO } from "date-fns";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Client, Trip, Referral, Commission } from "@workspace/api-client-react";

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------

export function fmtDate(d?: string | null): string {
  try {
    return d ? format(parseISO(d), "dd/MM/yyyy") : "";
  } catch {
    return d ?? "";
  }
}

export function fmtCur(v?: number | string | null): string {
  if (v == null) return "0,00";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

// --------------------------------------------------------------------------
// Date range filter
// --------------------------------------------------------------------------

export function inDateRange(
  dateStr: string | null | undefined,
  start: string,
  end: string,
): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= start && d <= end;
}

// --------------------------------------------------------------------------
// Prepare functions — each returns { headers, rows, count }
// --------------------------------------------------------------------------

export function prepareClients(
  all: Client[],
  quickStart: string,
  quickEnd: string,
): { headers: string[]; rows: string[][]; count: number } {
  const clients = all.filter((c) => inDateRange(c.createdAt, quickStart, quickEnd));
  const headers = [
    "Nome", "E-mail", "WhatsApp", "Telefone", "CPF", "Nascimento", "Gênero",
    "Cidade", "Estado", "Instagram", "Classificação", "Status", "Pipeline",
    "Total Gasto (R$)", "Saldo Devedor (R$)", "Tags", "Destinos Sonhados",
    "Observações", "Cadastrado em",
  ];
  const rows = clients.map((c) => [
    c.name, c.email, c.whatsapp, c.phone ?? "", c.cpf ?? "",
    fmtDate(c.birthDate), c.gender ?? "", c.addressCity ?? "", c.addressState ?? "",
    c.instagram ?? "", c.classification ?? "", c.status ?? "", c.pipelineStage ?? "",
    fmtCur(c.totalSpent), fmtCur(c.outstandingBalance),
    (c.tags ?? []).join("; "), (c.dreamDestinations ?? []).join("; "),
    c.observations ?? "", fmtDate(c.createdAt),
  ]);
  return { headers, rows, count: clients.length };
}

export function prepareTrips(
  all: Trip[],
  quickStart: string,
  quickEnd: string,
): { headers: string[]; rows: string[][]; count: number } {
  const trips = all.filter((t) => inDateRange(t.departureDate, quickStart, quickEnd));
  const headers = [
    "Nome", "Destino", "Cidade", "Estado", "Tipo", "Categoria", "Saída", "Retorno",
    "Capacidade Total", "Vagas Disponíveis", "Vagas Reservadas",
    "Preço Adulto (R$)", "Preço Criança (R$)", "Preço Sênior (R$)",
    "Status", "Pública", "Criado em",
  ];
  const rows = trips.map((t) => [
    t.name, t.destination, t.destinationCity, t.destinationState,
    t.type, t.category, fmtDate(t.departureDate), fmtDate(t.returnDate ?? undefined),
    String(t.totalCapacity), String(t.availableSeats), String(t.reservedSeats),
    fmtCur(t.priceAdult), fmtCur(t.priceChild ?? 0), fmtCur(t.priceSenior ?? 0),
    t.status, t.isPublic ? "Sim" : "Não", fmtDate(t.createdAt),
  ]);
  return { headers, rows, count: trips.length };
}

// Reservation item shape used by prepareManifest / prepareReservations
export interface ReservationItem {
  id: string;
  createdAt: string;
  status: string;
  seats?: string[];
  totalValue: number;
  paidValue: number;
  balance: number;
  paymentMethod?: string | null;
  installments?: number | null;
  client?: { name?: string; whatsapp?: string } | null;
  trip?: { name?: string; departureDate?: string } | null;
}

export function prepareManifest(
  all: ReservationItem[],
  quickStart: string,
  quickEnd: string,
): { headers: string[]; rows: string[][]; count: number } {
  const filtered = all.filter((r) =>
    inDateRange(r.trip?.departureDate, quickStart, quickEnd),
  );
  const headers = [
    "Viagem", "Data de Saída", "Passageiro", "WhatsApp", "Assento", "Status", "Reserva",
  ];
  const rows: string[][] = [];
  for (const r of filtered) {
    for (const seat of r.seats ?? []) {
      rows.push([
        r.trip?.name ?? "",
        fmtDate(r.trip?.departureDate),
        r.client?.name ?? "",
        r.client?.whatsapp ?? "",
        String(seat),
        r.status,
        r.id,
      ]);
    }
  }
  return { headers, rows, count: rows.length };
}

export function prepareReferrals(
  all: Referral[],
  quickStart: string,
  quickEnd: string,
): { headers: string[]; rows: string[][]; count: number } {
  const referrals = all.filter((r) => inDateRange(r.createdAt, quickStart, quickEnd));
  const headers = [
    "ID", "Código", "Indicador", "Indicado", "E-mail do Indicado",
    "Status", "Bônus (R$)", "Bônus Pago", "Convertido em", "Criado em",
  ];
  const rows = referrals.map((r) => [
    r.id, r.code,
    r.referrerName ?? r.referrerId,
    r.referredName ?? r.referredEmail ?? r.referredId ?? "",
    r.referredEmail ?? "", r.status,
    fmtCur(r.bonusAmount), r.bonusPaid ? "Sim" : "Não",
    fmtDate((r as Referral & { convertedAt?: string | null }).convertedAt ?? undefined),
    fmtDate(r.createdAt),
  ]);
  return { headers, rows, count: referrals.length };
}

export function prepareCommissions(
  all: Commission[],
  quickStart: string,
  quickEnd: string,
): { headers: string[]; rows: string[][]; count: number } {
  const commissions = all.filter((c) => inDateRange(c.createdAt, quickStart, quickEnd));
  const headers = [
    "ID", "Vendedor", "ID da Reserva", "Status",
    "Valor Base (R$)", "Valor Comissão (R$)", "Pago em", "Criado em",
  ];
  const rows = commissions.map((c) => [
    c.id, c.sellerName ?? c.userId, c.reservationId ?? "",
    c.status, fmtCur(c.baseAmount), fmtCur(c.commissionAmount),
    fmtDate(c.paidAt ?? undefined), fmtDate(c.createdAt),
  ]);
  return { headers, rows, count: commissions.length };
}

// --------------------------------------------------------------------------
// Download helpers
// --------------------------------------------------------------------------

export function downloadXlsx(
  headers: string[],
  rows: string[][],
  filename: string,
): void {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dados");
  XLSX.writeFile(wb, filename);
}

export function downloadPdf(
  title: string,
  headers: string[],
  rows: string[][],
  filename: string,
): void {
  const doc = new jsPDF("landscape");
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 16);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    14,
    22,
  );
  autoTable(doc, {
    startY: 28,
    head: [headers],
    body: rows,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [59, 130, 246] },
  });
  doc.save(filename);
}
