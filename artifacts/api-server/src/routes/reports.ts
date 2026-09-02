import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { paymentsTable, reservationsTable, clientsTable, tripsTable, expensesTable, passengersTable } from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";
import { RESERVATION_STATUS, ACTIVE_RESERVATION_STATUSES, PAYMENT_STATUS, PAYMENT_TYPE, EXPENSE_STATUS, ACTIONS, hasPermission, RESOURCES } from "@workspace/permissions";
import { formatBRLPlain, localToday } from "@workspace/shared";
import { z } from "zod/v4";
import { MAX_REPORT_RANGE_DAYS, MAX_EXPORT_ROWS } from "../lib/list-limits";

applyPlugin(jsPDF);

const router = Router();

const ReportExportBody = z.object({
  reportType: z.enum(["financial", "sales", "clients", "trips", "manifest"]),
  format: z.enum(["csv", "xlsx", "pdf"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type JsPDFWithAutoTable = InstanceType<typeof jsPDF> & {
  autoTable: (opts: Record<string, unknown>) => void;
  lastAutoTable: { finalY: number };
};

const _BRAZIL_TZ = "America/Sao_Paulo";
function fmtDate(d?: Date | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: _BRAZIL_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch { return ""; }
}

function fmtCur(v?: string | number | null): string {
  if (v == null || v === "") return "R$ 0,00";
  return formatBRLPlain(Number(v));
}

function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function pdfHeader(doc: JsPDFWithAutoTable, title: string, period: string) {
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 18);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Período: ${period}`, 14, 25);
  doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, 14, 30);
  return 38;
}

function pdfSection(doc: JsPDFWithAutoTable, title: string, y: number): number {
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, y);
  return y + 6;
}

router.post("/reports/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (!hasPermission(me.role, RESOURCES.REPORTS, ACTIONS.VIEW)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const parsed = ReportExportBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR"));
      return;
    }
    const { reportType, format: fmt, startDate, endDate } = parsed.data;

    const tenantId = me.tenantId;
    // Default start-of-month uses Brazil calendar so the report covers the correct month at night
    const _todayBR = localToday();
    const [_repYear, _repMonth1] = _todayBR.split("-").map(Number);
    const start = startDate ? new Date(startDate) : new Date(Date.UTC(_repYear, _repMonth1 - 1, 1, 3, 0, 0, 0));
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();
    const periodLabel = `${fmtDate(start)} a ${fmtDate(end)}`;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      next(new ValidationError("startDate/endDate inválidos", "VALIDATION_ERROR"));
      return;
    }
    if (start > end) {
      next(new ValidationError("startDate deve ser anterior ou igual a endDate", "VALIDATION_ERROR"));
      return;
    }
    if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_REPORT_RANGE_DAYS) {
      next(new ValidationError(`Intervalo máximo para exportação é de ${MAX_REPORT_RANGE_DAYS} dias. Reduza o período.`, "VALIDATION_ERROR"));
      return;
    }

    // ── FINANCIAL ──────────────────────────────────────────────────────────────
    if (reportType === "financial") {
      const [payments, expenses] = await Promise.all([
        db.select({
          id: paymentsTable.id,
          type: paymentsTable.type,
          category: paymentsTable.category,
          description: paymentsTable.description,
          amount: paymentsTable.amount,
          status: paymentsTable.status,
          paymentMethod: paymentsTable.paymentMethod,
          dueDate: paymentsTable.dueDate,
          paidAt: paymentsTable.paidAt,
          createdAt: paymentsTable.createdAt,
        }).from(paymentsTable).where(and(
          eq(paymentsTable.tenantId, tenantId),
          gte(paymentsTable.createdAt, start),
          lte(paymentsTable.createdAt, end),
        )).limit(MAX_EXPORT_ROWS + 1),
        db.select().from(expensesTable).where(and(
          eq(expensesTable.tenantId, tenantId),
          gte(expensesTable.createdAt, start),
          lte(expensesTable.createdAt, end),
        )).limit(MAX_EXPORT_ROWS + 1),
      ]);

      if (payments.length > MAX_EXPORT_ROWS || expenses.length > MAX_EXPORT_ROWS) {
        next(new ValidationError(`Volume de dados muito grande para exportação direta (limite de ${MAX_EXPORT_ROWS} registros). Reduza o período.`, "VALIDATION_ERROR"));
        return;
      }

      const receivables = payments.filter(p => p.type === PAYMENT_TYPE.RECEIVABLE);
      const payables = payments.filter(p => p.type === PAYMENT_TYPE.PAYABLE);
      const totalReceived = receivables.filter(p => p.status === PAYMENT_STATUS.PAID).reduce((s, p) => s + Number(p.amount), 0);
      const totalPending = receivables.filter(p => p.status === PAYMENT_STATUS.PENDING).reduce((s, p) => s + Number(p.amount), 0);
      const totalExpenses = payables.filter(p => p.status === PAYMENT_STATUS.PAID).reduce((s, p) => s + Number(p.amount), 0) +
        expenses.reduce((s, e) => s + Number(e.amount), 0);
      const profit = totalReceived - totalExpenses;

      if (fmt === "csv") {
        const headers = ["Tipo", "Categoria", "Descrição", "Valor", "Status", "Vencimento", "Pago em", "Método"];
        const rows = receivables.map(p => [
          p.type, p.category, p.description ?? "", fmtCur(p.amount),
          p.status, fmtDate(p.dueDate), fmtDate(p.paidAt), p.paymentMethod,
        ]);
        const csv = "\uFEFF" + buildCsv([headers, ...rows]);
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="financeiro_receitas_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.csv"`);
        res.send(csv);
        return;
      }

      if (fmt === "pdf") {
        const doc = new jsPDF("landscape") as JsPDFWithAutoTable;
        let y = pdfHeader(doc, "Relatório Financeiro", periodLabel);

        y = pdfSection(doc, "Resumo Financeiro", y);
        doc.autoTable({
          startY: y,
          head: [["Indicador", "Valor"]],
          body: [
            ["Total Recebido", fmtCur(totalReceived)],
            ["Receitas Pendentes", fmtCur(totalPending)],
            ["Total Despesas", fmtCur(totalExpenses)],
            ["Lucro Líquido", fmtCur(profit)],
          ],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [59, 130, 246] },
          columnStyles: { 1: { halign: "right" } },
        });

        doc.addPage();
        pdfSection(doc, "Receitas", 18);
        doc.autoTable({
          startY: 24,
          head: [["Categoria", "Descrição", "Valor", "Status", "Vencimento", "Pago em"]],
          body: receivables.map(p => [
            p.category, p.description ?? "", fmtCur(p.amount),
            p.status === PAYMENT_STATUS.PAID ? "Pago" : "Pendente",
            fmtDate(p.dueDate), fmtDate(p.paidAt),
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [34, 197, 94] },
        });

        if (payables.length > 0 || expenses.length > 0) {
          doc.addPage();
          pdfSection(doc, "Despesas", 18);
          const allExpRows = [
            ...payables.map(p => [p.category, p.description ?? "", fmtCur(p.amount), p.status === PAYMENT_STATUS.PAID ? "Pago" : "Pendente", fmtDate(p.dueDate), fmtDate(p.paidAt)]),
            ...expenses.map(e => [e.category, e.description, fmtCur(e.amount), e.status === EXPENSE_STATUS.PAID ? "Pago" : "Pendente", fmtDate(e.dueDate), fmtDate(e.paymentDate)]),
          ];
          doc.autoTable({
            startY: 24,
            head: [["Categoria", "Descrição", "Valor", "Status", "Vencimento", "Pago em"]],
            body: allExpRows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [239, 68, 68] },
          });
        }

        const buf = Buffer.from(doc.output("arraybuffer"));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="financeiro_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.pdf"`);
        res.send(buf);
        return;
      }

      if (fmt === "xlsx") {
        const wb = new ExcelJS.Workbook();
        wb.creator = "VisiteCRM";
        wb.created = new Date();

        // Sheet 1: Resumo
        const ws1 = wb.addWorksheet("Resumo");
        ws1.columns = [{ header: "Indicador", key: "k", width: 30 }, { header: "Valor", key: "v", width: 20 }];
        ws1.getRow(1).font = { bold: true };
        ws1.addRows([
          { k: "Total Recebido", v: totalReceived },
          { k: "Receitas Pendentes", v: totalPending },
          { k: "Total Despesas", v: totalExpenses },
          { k: "Lucro Líquido", v: profit },
        ]);
        ws1.getColumn("v").numFmt = '"R$"#,##0.00';

        // Sheet 2: Receitas
        const ws2 = wb.addWorksheet("Receitas");
        ws2.columns = [
          { header: "Categoria", key: "category", width: 20 },
          { header: "Descrição", key: "description", width: 30 },
          { header: "Valor", key: "amount", width: 16 },
          { header: "Status", key: "status", width: 12 },
          { header: "Vencimento", key: "dueDate", width: 14 },
          { header: "Pago em", key: "paidAt", width: 14 },
          { header: "Método", key: "method", width: 16 },
        ];
        ws2.getRow(1).font = { bold: true };
        for (const p of receivables) {
          ws2.addRow({ category: p.category, description: p.description ?? "", amount: Number(p.amount), status: p.status === PAYMENT_STATUS.PAID ? "Pago" : "Pendente", dueDate: fmtDate(p.dueDate), paidAt: fmtDate(p.paidAt), method: p.paymentMethod });
        }
        ws2.getColumn("amount").numFmt = '"R$"#,##0.00';

        // Sheet 3: Despesas
        const ws3 = wb.addWorksheet("Despesas");
        ws3.columns = [
          { header: "Categoria", key: "category", width: 20 },
          { header: "Descrição", key: "description", width: 30 },
          { header: "Valor", key: "amount", width: 16 },
          { header: "Status", key: "status", width: 12 },
          { header: "Vencimento", key: "dueDate", width: 14 },
          { header: "Pago em", key: "paidAt", width: 14 },
        ];
        ws3.getRow(1).font = { bold: true };
        for (const p of payables) {
          ws3.addRow({ category: p.category, description: p.description ?? "", amount: Number(p.amount), status: p.status === PAYMENT_STATUS.PAID ? "Pago" : "Pendente", dueDate: fmtDate(p.dueDate), paidAt: fmtDate(p.paidAt) });
        }
        for (const e of expenses) {
          ws3.addRow({ category: e.category, description: e.description, amount: Number(e.amount), status: e.status === EXPENSE_STATUS.PAID ? "Pago" : "Pendente", dueDate: fmtDate(e.dueDate), paidAt: fmtDate(e.paymentDate) });
        }
        ws3.getColumn("amount").numFmt = '"R$"#,##0.00';

        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="financeiro_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.xlsx"`);
        res.send(Buffer.from(buf));
        return;
      }
    }

    // ── SALES ──────────────────────────────────────────────────────────────────
    if (reportType === "sales") {
      const reservations = await db.select({
        id: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        status: reservationsTable.status,
        totalValue: reservationsTable.totalValue,
        paidValue: reservationsTable.paidValue,
        balance: reservationsTable.balance,
        paymentMethod: reservationsTable.paymentMethod,
        installments: reservationsTable.installments,
        seats: reservationsTable.seats,
        tripId: reservationsTable.tripId,
        clientId: reservationsTable.clientId,
        createdAt: reservationsTable.createdAt,
        confirmedAt: reservationsTable.confirmedAt,
      }).from(reservationsTable).where(and(
        eq(reservationsTable.tenantId, tenantId),
        gte(reservationsTable.createdAt, start),
        lte(reservationsTable.createdAt, end),
      )).limit(MAX_EXPORT_ROWS + 1);

      if (reservations.length > MAX_EXPORT_ROWS) {
        next(new ValidationError(`Volume de dados muito grande para exportação direta (limite de ${MAX_EXPORT_ROWS} registros). Reduza o período.`, "VALIDATION_ERROR"));
        return;
      }

      const tripIds = [...new Set(reservations.map(r => r.tripId))].filter(Boolean);
      const clientIds = [...new Set(reservations.map(r => r.clientId))].filter((id): id is string => Boolean(id));

      const [tripsData, clientsData] = await Promise.all([
        tripIds.length > 0
          ? db.select({ id: tripsTable.id, name: tripsTable.name, departureDate: tripsTable.departureDate, destination: tripsTable.destination })
            .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), inArray(tripsTable.id, tripIds)))
          : [],
        clientIds.length > 0
          ? db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
            .from(clientsTable).where(and(eq(clientsTable.tenantId, tenantId), inArray(clientsTable.id, clientIds)))
          : [],
      ]);

      const tripMap = new Map(tripsData.map(t => [t.id, t]));
      const clientMap = new Map(clientsData.map(c => [c.id, c]));

      const totalSales = reservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).reduce((s, r) => s + Number(r.totalValue), 0);
      const totalPaid = reservations.reduce((s, r) => s + Number(r.paidValue), 0);
      const confirmedCount = reservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).length;
      const pendingCount = reservations.filter(r => r.status === RESERVATION_STATUS.PENDING).length;

      const headers = ["Nº Reserva", "Cliente", "Email", "Viagem", "Destino", "Saída", "Status", "Assentos", "Valor Total", "Valor Pago", "Saldo", "Forma Pgto", "Parcelas", "Criado em", "Confirmado em"];
      const rows = reservations.map(r => {
        const trip = tripMap.get(r.tripId);
        const client = r.clientId ? clientMap.get(r.clientId) : undefined;
        return [
          r.reservationNumber ?? r.id.slice(0, 8),
          client?.name ?? "", client?.email ?? "",
          trip?.name ?? "", trip?.destination ?? "", fmtDate(trip?.departureDate),
          r.status, String(r.seats.length),
          fmtCur(r.totalValue), fmtCur(r.paidValue), fmtCur(r.balance),
          r.paymentMethod ?? "", String(r.installments),
          fmtDate(r.createdAt), fmtDate(r.confirmedAt),
        ];
      });

      if (fmt === "csv") {
        const csv = "\uFEFF" + buildCsv([headers, ...rows]);
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="vendas_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.csv"`);
        res.send(csv);
        return;
      }

      if (fmt === "xlsx") {
        const wb = new ExcelJS.Workbook();
        wb.creator = "VisiteCRM";

        const ws1 = wb.addWorksheet("Resumo");
        ws1.columns = [{ header: "Indicador", key: "k", width: 30 }, { header: "Valor", key: "v", width: 20 }];
        ws1.getRow(1).font = { bold: true };
        ws1.addRows([
          { k: "Total de Reservas", v: reservations.length },
          { k: "Confirmadas", v: confirmedCount },
          { k: "Pendentes", v: pendingCount },
          { k: "Total Vendido (confirmadas)", v: totalSales },
          { k: "Total Recebido", v: totalPaid },
        ]);
        ws1.getColumn("v").numFmt = '#,##0.00';

        const ws2 = wb.addWorksheet("Reservas");
        ws2.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i < 3 ? 24 : 16 }));
        ws2.getRow(1).font = { bold: true };
        for (const row of rows) {
          const obj: Record<string, string | number> = {};
          row.forEach((v, i) => { obj[`c${i}`] = v; });
          ws2.addRow(obj);
        }

        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="vendas_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.xlsx"`);
        res.send(Buffer.from(buf));
        return;
      }

      if (fmt === "pdf") {
        const doc = new jsPDF("landscape") as JsPDFWithAutoTable;
        pdfHeader(doc, "Relatório de Vendas", periodLabel);

        doc.autoTable({
          startY: 38,
          head: [["Indicador", "Valor"]],
          body: [
            ["Total de Reservas", String(reservations.length)],
            ["Confirmadas", String(confirmedCount)],
            ["Pendentes", String(pendingCount)],
            ["Total Vendido", fmtCur(totalSales)],
            ["Total Recebido", fmtCur(totalPaid)],
          ],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [59, 130, 246] },
          tableWidth: 100,
        });

        doc.addPage();
        doc.autoTable({
          startY: 14,
          head: [["Nº Reserva", "Cliente", "Viagem", "Status", "Assentos", "Total", "Pago", "Criado em"]],
          body: reservations.map(r => {
            const trip = tripMap.get(r.tripId);
            const client = r.clientId ? clientMap.get(r.clientId) : undefined;
            return [
              r.reservationNumber ?? r.id.slice(0, 8),
              client?.name ?? "", trip?.name ?? "",
              r.status, String(r.seats.length),
              fmtCur(r.totalValue), fmtCur(r.paidValue),
              fmtDate(r.createdAt),
            ];
          }),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [59, 130, 246] },
        });

        const buf = Buffer.from(doc.output("arraybuffer"));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="vendas_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.pdf"`);
        res.send(buf);
        return;
      }
    }

    // ── CLIENTS ────────────────────────────────────────────────────────────────
    if (reportType === "clients") {
      const clients = await db.select().from(clientsTable).where(and(
        eq(clientsTable.tenantId, tenantId),
        gte(clientsTable.createdAt, start),
        lte(clientsTable.createdAt, end),
      )).limit(MAX_EXPORT_ROWS + 1);

      if (clients.length > MAX_EXPORT_ROWS) {
        next(new ValidationError(`Volume de dados muito grande para exportação direta (limite de ${MAX_EXPORT_ROWS} registros). Reduza o período.`, "VALIDATION_ERROR"));
        return;
      }

      const headers = ["Nome", "Email", "WhatsApp", "CPF", "Nascimento", "Gênero", "Cidade", "Estado", "Classificação", "Status", "Total Gasto", "Saldo Devedor", "Tags", "Destinos Sonhados", "Cadastrado em"];
      const rows = clients.map(c => [
        c.name, c.email, c.whatsapp, c.cpf ?? "",
        fmtDate(c.birthDate), c.gender ?? "",
        c.addressCity ?? "", c.addressState ?? "",
        c.classification, c.status,
        fmtCur(c.totalSpent), fmtCur(c.outstandingBalance),
        (c.tags ?? []).join("; "),
        (c.dreamDestinations ?? []).join("; "),
        fmtDate(c.createdAt),
      ]);

      if (fmt === "csv") {
        const csv = "\uFEFF" + buildCsv([headers, ...rows]);
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="clientes_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.csv"`);
        res.send(csv);
        return;
      }

      if (fmt === "xlsx") {
        const wb = new ExcelJS.Workbook();
        wb.creator = "VisiteCRM";
        const ws = wb.addWorksheet("Clientes");
        ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i < 4 ? 24 : 16 }));
        ws.getRow(1).font = { bold: true };
        for (const row of rows) {
          const obj: Record<string, string | number> = {};
          row.forEach((v, i) => { obj[`c${i}`] = v as string; });
          ws.addRow(obj);
        }
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="clientes_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.xlsx"`);
        res.send(Buffer.from(buf));
        return;
      }

      if (fmt === "pdf") {
        const doc = new jsPDF("landscape") as JsPDFWithAutoTable;
        pdfHeader(doc, "Relatório de Clientes", periodLabel);

        doc.autoTable({
          startY: 38,
          head: [["Nome", "Email", "WhatsApp", "Cidade/Estado", "Classificação", "Total Gasto", "Status", "Cadastrado em"]],
          body: clients.map(c => [
            c.name, c.email, c.whatsapp,
            [c.addressCity, c.addressState].filter(Boolean).join("/"),
            c.classification, fmtCur(c.totalSpent), c.status,
            fmtDate(c.createdAt),
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [59, 130, 246] },
        });

        const buf = Buffer.from(doc.output("arraybuffer"));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="clientes_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.pdf"`);
        res.send(buf);
        return;
      }
    }

    // ── TRIPS ──────────────────────────────────────────────────────────────────
    if (reportType === "trips") {
      const trips = await db.select().from(tripsTable).where(and(
        eq(tripsTable.tenantId, tenantId),
        gte(tripsTable.departureDate, start),
        lte(tripsTable.departureDate, end),
      )).limit(MAX_EXPORT_ROWS + 1);

      if (trips.length > MAX_EXPORT_ROWS) {
        next(new ValidationError(`Volume de dados muito grande (limite de ${MAX_EXPORT_ROWS} registros). Reduza o período.`, "VALIDATION_ERROR"));
        return;
      }

      const headers = ["Nome", "Destino", "Cidade", "Estado", "Tipo", "Categoria", "Saída", "Retorno", "Capacidade", "Disponível", "Reservado", "Preço Adulto", "Status"];
      const rows = trips.map(t => [
        t.name, t.destination, t.destinationCity ?? "", t.destinationState ?? "",
        t.type, t.category ?? "",
        fmtDate(t.departureDate), fmtDate(t.returnDate),
        String(t.totalCapacity), String(t.availableSeats), String(t.reservedSeats),
        fmtCur(t.priceAdult), t.status,
      ]);

      if (fmt === "csv") {
        const csv = "\uFEFF" + buildCsv([headers, ...rows]);
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="viagens_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.csv"`);
        res.send(csv); return;
      }

      if (fmt === "xlsx") {
        const wb = new ExcelJS.Workbook();
        wb.creator = "VisiteCRM";
        const ws = wb.addWorksheet("Viagens");
        ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: i < 2 ? 28 : 16 }));
        ws.getRow(1).font = { bold: true };
        for (const row of rows) {
          const obj: Record<string, string> = {};
          row.forEach((v, i) => { obj[`c${i}`] = v; });
          ws.addRow(obj);
        }
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="viagens_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.xlsx"`);
        res.send(Buffer.from(buf)); return;
      }

      if (fmt === "pdf") {
        const doc = new jsPDF("landscape") as JsPDFWithAutoTable;
        pdfHeader(doc, "Relatório de Viagens", periodLabel);
        doc.autoTable({
          startY: 38,
          head: [["Nome", "Destino", "Saída", "Retorno", "Capacidade", "Disponível", "Reservado", "Status"]],
          body: trips.map(t => [
            t.name, t.destination,
            fmtDate(t.departureDate), fmtDate(t.returnDate),
            String(t.totalCapacity), String(t.availableSeats), String(t.reservedSeats),
            t.status,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [59, 130, 246] },
        });
        const buf = Buffer.from(doc.output("arraybuffer"));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="viagens_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.pdf"`);
        res.send(buf); return;
      }
    }

    // ── MANIFEST ───────────────────────────────────────────────────────────────
    if (reportType === "manifest") {
      const passengers = await db.select({
        passName: passengersTable.name,
        passCpf: passengersTable.cpf,
        passBirthDate: passengersTable.birthDate,
        passAgeCategory: passengersTable.ageCategory,
        passSeatNumber: passengersTable.seatNumber,
        passBoardingLocationId: passengersTable.boardingLocationId,
        passPhone: passengersTable.phone,
        resId: reservationsTable.id,
        resNumber: reservationsTable.reservationNumber,
        resStatus: reservationsTable.status,
        tripName: tripsTable.name,
        tripDeparture: tripsTable.departureDate,
        tripBoardingPoints: tripsTable.boardingPoints,
      })
        .from(passengersTable)
        .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
        .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
        .where(and(
          eq(reservationsTable.tenantId, tenantId),
          gte(tripsTable.departureDate, start),
          lte(tripsTable.departureDate, end),
          inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
        )).limit(MAX_EXPORT_ROWS + 1);

      if (passengers.length > MAX_EXPORT_ROWS) {
        next(new ValidationError(`Volume de dados muito grande (limite de ${MAX_EXPORT_ROWS} registros). Reduza o período.`, "VALIDATION_ERROR"));
        return;
      }

      const ageCategoryLabel: Record<string, string> = {
        adult: "Adulto", child: "Criança", senior: "Sênior", infant: "Bebê",
      };

      const manifestHeaders = ["Nº", "Viagem", "Data de Saída", "Nº Reserva", "Passageiro", "CPF", "Nascimento", "Categoria", "Poltrona", "Ponto de Embarque", "Telefone", "Status"];
      const manifestRows: string[][] = [];
      let seq = 0;
      for (const p of passengers) {
        seq++;
        const boardingPoints = (p.tripBoardingPoints ?? []) as { id: string; name: string }[];
        const boardingPoint = boardingPoints.find(bp => bp.id === p.passBoardingLocationId);
        manifestRows.push([
          String(seq),
          p.tripName, fmtDate(p.tripDeparture),
          p.resNumber ?? p.resId.slice(0, 8),
          p.passName,
          p.passCpf ?? "",
          fmtDate(p.passBirthDate),
          ageCategoryLabel[p.passAgeCategory] ?? p.passAgeCategory,
          p.passSeatNumber ?? "",
          boardingPoint?.name ?? "",
          p.passPhone ?? "",
          p.resStatus,
        ]);
      }

      if (fmt === "csv") {
        const csv = "\uFEFF" + buildCsv([manifestHeaders, ...manifestRows]);
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="manifesto_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.csv"`);
        res.send(csv); return;
      }

      if (fmt === "xlsx") {
        const wb = new ExcelJS.Workbook();
        wb.creator = "VisiteCRM";
        const ws = wb.addWorksheet("Manifesto ANTT");
        ws.columns = manifestHeaders.map((h, i) => ({ header: h, key: `c${i}`, width: i === 4 ? 28 : i < 3 ? 20 : 14 }));
        ws.getRow(1).font = { bold: true };
        for (const row of manifestRows) {
          const obj: Record<string, string> = {};
          row.forEach((v, i) => { obj[`c${i}`] = v; });
          ws.addRow(obj);
        }
        const buf = await wb.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="manifesto_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.xlsx"`);
        res.send(Buffer.from(buf)); return;
      }

      if (fmt === "pdf") {
        const doc = new jsPDF("landscape") as JsPDFWithAutoTable;
        pdfHeader(doc, "Manifesto ANTT de Passageiros", periodLabel);
        doc.autoTable({
          startY: 38,
          head: [["Nº", "Viagem", "Saída", "Nº Reserva", "Passageiro", "CPF", "Nascimento", "Categoria", "Poltrona", "Ponto de Embarque"]],
          body: manifestRows.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]]),
          styles: { fontSize: 6 },
          headStyles: { fillColor: [59, 130, 246] },
        });
        const buf = Buffer.from(doc.output("arraybuffer"));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="manifesto_${new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10).replaceAll("-", "")}.pdf"`);
        res.send(buf); return;
      }
    }

    next(new ValidationError("Combinação de reportType e format inválida", "VALIDATION_ERROR"));
  } catch (err) {
    next(err);
  }
});

export default router;
