import { createHash } from "node:crypto";
import { Router, type NextFunction } from "express";
import { z } from "zod";
import { and, count, eq, or, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  tripsTable,
  reservationsTable,
  paymentsTable,
  expensesTable,
  referralsTable,
  commissionsTable,
  usersTable,
  pipelinesTable,
  pipelineStagesTable,
  dealsTable,
  tenantsTable,
  plansTable,
  spreadsheetImportBatchesTable,
  spreadsheetImportRecordsTable,
  type SpreadsheetImportEntity,
  type SpreadsheetImportReport,
  type SpreadsheetImportRowResult,
} from "@workspace/db";
import { ADMIN_ROLES } from "../lib/tenant.js";
import { requireAuth } from "../lib/tenant.js";
import { AppError, ForbiddenError, ValidationError } from "../lib/errors.js";
import { generateId, generateVoucherCode } from "../lib/id.js";
import { getTenantReservationPrefix, getYearMonth, nextReservationSequence, buildReservationNumber, tripTypeToCode } from "../lib/reservation-number.js";
import { syncReservationPaymentStatus } from "../lib/reservation-payments.js";
import {
  createCsvTemplate,
  createXlsxTemplate,
  getSpreadsheetContract,
  optionalText,
  parseBooleanPt,
  parseBrazilDate,
  parseBrazilMoney,
  parseCpf,
  parsePhone,
  parseSpreadsheet,
  requireText,
  validateHeaders,
  type CellRow,
  type SpreadsheetEntity,
} from "../lib/spreadsheet-import.js";

const router = Router();
const BRAZILIAN_UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);
const OCCUPYING_RESERVATION_STATUSES = new Set(["pending", "confirmed", "completed"]);

const EntitySchema = z.enum([
  "clients",
  "trips",
  "reservations",
  "payments",
  "expenses",
  "referrals",
  "commissions",
  "deals",
]);
const UploadBody = z.object({
  entity: EntitySchema,
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(8_000_000),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

type ImportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ParsedEntityRow = {
  line: number;
  sourceKey?: string;
  label?: string;
  data?: Record<string, unknown>;
  action: "created" | "updated" | "rejected";
  reason?: string;
  targetId?: string;
};

async function getRemainingImportCapacity(
  queryDb: Pick<typeof db, "select">,
  tenantId: string,
  resource: "clients" | "trips",
): Promise<number> {
  const [tenant] = await queryDb.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  if (!tenant) throw new ForbiddenError("Agência não encontrada.", "TENANT_NOT_FOUND");
  if (tenant.status === "suspended") throw new ForbiddenError("Esta conta está suspensa.", "TENANT_SUSPENDED");
  if (tenant.status === "cancelled") throw new ForbiddenError("A assinatura desta conta foi cancelada.", "SUBSCRIPTION_CANCELLED");
  if (tenant.status === "pending_payment") throw new ForbiddenError("É necessário concluir o pagamento para continuar.", "SUBSCRIPTION_PAYMENT_REQUIRED");
  if (tenant.status === "trial" && tenant.trialEndsAt && tenant.trialEndsAt < new Date()) {
    throw new ForbiddenError("O período de teste expirou. Assine um plano para continuar.", "TRIAL_EXPIRED");
  }
  const [plan] = await queryDb.select().from(plansTable)
    .where(or(eq(plansTable.slug, tenant.planId), eq(plansTable.id, tenant.planId))).limit(1);
  if (resource === "clients") {
    const [current] = await queryDb.select({ value: count() }).from(clientsTable).where(eq(clientsTable.tenantId, tenantId));
    return Math.max(0, (tenant.maxClientsOverride ?? plan?.maxClients ?? 500) - (current?.value ?? 0));
  }
  const [current] = await queryDb.select({ value: count() }).from(tripsTable).where(eq(tripsTable.tenantId, tenantId));
  return Math.max(0, (tenant.maxTripsOverride ?? plan?.maxTrips ?? 20) - (current?.value ?? 0));
}

function applyPlanCapacity(rows: ParsedEntityRow[], remainingCapacity: number, entity: "clients" | "trips"): void {
  let creationsAccepted = 0;
  for (const row of rows) {
    if (row.action !== "created") continue;
    if (creationsAccepted >= remainingCapacity) {
      row.action = "rejected";
      row.reason = `Limite do plano atingido para ${entity === "clients" ? "clientes" : "viagens"}.`;
    } else {
      creationsAccepted += 1;
    }
  }
}

function safeBuffer(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ValidationError("Conteúdo do arquivo inválido.", "SPREADSHEET_INVALID_BASE64");
  }
  return Buffer.from(base64, "base64");
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function tripFingerprint(data: Record<string, unknown>): string {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  return [
    normalize(data.name),
    normalize(data.destination),
    normalize(data.destinationCity),
    normalize(data.destinationState),
    (data.departureDate as Date).toISOString().slice(0, 10),
  ].join("|");
}

function positiveInteger(value: string, label: string, fallback?: number): number {
  if (!value && fallback != null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${label} deve ser um número inteiro positivo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} deve ser um número inteiro positivo.`);
  return parsed;
}

function enumValue(value: string, label: string, allowed: readonly string[], fallback?: string): string {
  const result = value.trim() || fallback;
  if (!result || !allowed.includes(result)) throw new Error(`${label} inválido. Valores aceitos: ${allowed.join(", ")}.`);
  return result;
}

function emailValue(value: string, label: string, optional = false): string | null {
  const result = value.trim().toLowerCase();
  if (!result && optional) return null;
  if (!result || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error(`${label} inválido.`);
  return result;
}

function parseRow(entity: SpreadsheetEntity, line: number, cells: CellRow): ParsedEntityRow {
  try {
    const sourceKey = requireText(cells, "id_externo", "ID Externo", 200);
    if (entity === "clients") {
      const cpf = parseCpf(requireText(cells, "cpf", "CPF", 32));
      const name = requireText(cells, "nome", "Nome");
      const whatsapp = parsePhone(requireText(cells, "whatsapp", "WhatsApp", 40), "WhatsApp")!;
      const email = optionalText(cells, "email", 320);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
      const state = optionalText(cells, "estado", 2);
      if (state && !BRAZILIAN_UFS.has(state.toUpperCase())) throw new Error("Estado deve ser uma UF brasileira válida.");
      return {
        line,
        sourceKey,
        label: name,
        action: "created",
        data: {
          name,
          cpf,
          whatsapp,
          email: email ?? `cliente-${cpf}@importado.invalid`,
          phone: parsePhone(cells.telefone ?? "", "Telefone", true),
          birthDate: parseBrazilDate(cells.data_nascimento ?? "", "Data de Nascimento"),
          addressCity: optionalText(cells, "cidade", 200),
          addressState: state?.toUpperCase() ?? null,
          status: enumValue(cells.status ?? "", "Status", ["active", "inactive", "lead", "prospect"], "active"),
          observations: optionalText(cells, "observacoes"),
        },
      };
    }
    if (entity === "trips") {
      const name = requireText(cells, "nome", "Nome");
      const destinationState = requireText(cells, "estado_destino", "Estado de Destino", 2).toUpperCase();
      if (!BRAZILIAN_UFS.has(destinationState)) throw new Error("Estado de Destino deve ser uma UF brasileira válida.");
      const departureDate = parseBrazilDate(requireText(cells, "data_saida", "Data de Saída", 10), "Data de Saída")!;
      const returnDate = parseBrazilDate(cells.data_retorno ?? "", "Data de Retorno");
      if (returnDate && returnDate < departureDate) throw new Error("Data de Retorno não pode ser anterior à Data de Saída.");
      const totalCapacity = positiveInteger(cells.capacidade ?? "", "Capacidade");
      const data = {
        name,
        destination: requireText(cells, "destino", "Destino"),
        destinationCity: requireText(cells, "cidade_destino", "Cidade de Destino"),
        destinationState,
        departureDate,
        returnDate,
        totalCapacity,
        priceAdult: parseBrazilMoney(requireText(cells, "preco_adulto", "Preço Adulto", 40), "Preço Adulto")!,
        priceChild: parseBrazilMoney(cells.preco_crianca ?? "", "Preço Criança", true),
        type: enumValue(cells.tipo ?? "", "Tipo", ["excursao", "pacote", "bate_volta"], "excursao"),
        category: enumValue(cells.categoria ?? "", "Categoria", ["standard", "premium", "luxury"], "standard"),
        status: enumValue(cells.status ?? "", "Status", ["draft", "published", "active", "confirmed", "cancelled", "completed"], "draft"),
      };
      return { line, sourceKey, label: name, action: "created", data: { ...data, importFingerprint: tripFingerprint(data) } };
    }
    if (entity === "payments") {
      const reservationSourceKey = optionalText(cells, "reserva_id_externo", 200);
      const clientSourceKey = optionalText(cells, "cliente_id_externo", 200);
      if (!reservationSourceKey && !clientSourceKey) {
        throw new Error("Informe o ID Externo da Reserva ou do Cliente.");
      }
      const status = enumValue(cells.status ?? "", "Status", ["pending", "paid", "overdue", "cancelled", "approved", "failed", "refunded", "charged_back"]);
      const paidAt = parseBrazilDate(cells.pago_em ?? "", "Pago em");
      if (status === "paid" && !paidAt) throw new Error("Pago em é obrigatório quando o status é paid.");
      const installmentNumber = positiveInteger(cells.numero_parcela ?? "", "Número da Parcela", 1);
      const totalInstallments = positiveInteger(cells.total_parcelas ?? "", "Total de Parcelas", 1);
      if (installmentNumber > totalInstallments) throw new Error("Número da Parcela não pode ser maior que Total de Parcelas.");
      return {
        line, sourceKey, label: optionalText(cells, "descricao") ?? sourceKey, action: "created",
        data: {
          reservationSourceKey,
          clientSourceKey,
          type: enumValue(cells.tipo ?? "", "Tipo", ["receivable", "payable"]),
          category: requireText(cells, "categoria", "Categoria"),
          description: optionalText(cells, "descricao"),
          amount: parseBrazilMoney(requireText(cells, "valor", "Valor", 40), "Valor")!,
          status,
          paymentMethod: requireText(cells, "forma_pagamento", "Forma de Pagamento", 100),
          dueDate: parseBrazilDate(requireText(cells, "vencimento", "Vencimento", 10), "Vencimento")!,
          paidAt,
          installmentNumber,
          totalInstallments,
          notes: optionalText(cells, "observacoes"),
        },
      };
    }
    if (entity === "expenses") {
      const status = enumValue(cells.status ?? "", "Status", ["pending", "paid", "overdue", "cancelled"]);
      const paymentDate = parseBrazilDate(cells.pago_em ?? "", "Pago em");
      if (status === "paid" && !paymentDate) throw new Error("Pago em é obrigatório quando o status é paid.");
      return {
        line, sourceKey, label: requireText(cells, "descricao", "Descrição"), action: "created",
        data: {
          tripSourceKey: optionalText(cells, "viagem_id_externo", 200),
          category: requireText(cells, "categoria", "Categoria"),
          description: requireText(cells, "descricao", "Descrição"),
          amount: parseBrazilMoney(requireText(cells, "valor", "Valor", 40), "Valor")!,
          status,
          paymentMethod: optionalText(cells, "forma_pagamento", 100),
          dueDate: parseBrazilDate(requireText(cells, "vencimento", "Vencimento", 10), "Vencimento")!,
          paymentDate,
          notes: optionalText(cells, "observacoes"),
        },
      };
    }
    if (entity === "referrals") {
      const referredSourceKey = optionalText(cells, "indicado_id_externo", 200);
      const referredEmail = emailValue(cells.email_indicado ?? "", "E-mail do Indicado", true);
      const referredPhone = parsePhone(cells.telefone_indicado ?? "", "Telefone do Indicado", true);
      const referredName = optionalText(cells, "nome_indicado");
      if (!referredSourceKey && !referredEmail && !referredPhone && !referredName) {
        throw new Error("Informe o cliente indicado ou ao menos um dado explícito do lead indicado.");
      }
      const bonusPaid = parseBooleanPt(cells.bonus_pago ?? "", "Bônus Pago");
      const bonusPaidAt = parseBrazilDate(cells.bonus_pago_em ?? "", "Bônus Pago em");
      const convertedAt = parseBrazilDate(cells.convertido_em ?? "", "Convertido em");
      const status = enumValue(cells.status ?? "", "Status", ["pending", "completed", "converted", "expired", "reversed"]);
      if (bonusPaid && !bonusPaidAt) throw new Error("Bônus Pago em é obrigatório quando Bônus Pago é sim.");
      if (["completed", "converted", "reversed"].includes(status) && !convertedAt) {
        throw new Error("Convertido em é obrigatório para indicações convertidas ou revertidas.");
      }
      if (bonusPaid && status !== "completed") throw new Error("Bônus pago só é compatível com status completed.");
      if (bonusPaidAt && convertedAt && bonusPaidAt < convertedAt) {
        throw new Error("Bônus Pago em não pode ser anterior à conversão.");
      }
      return {
        line, sourceKey, label: referredName ?? referredEmail ?? referredSourceKey ?? sourceKey, action: "created",
        data: {
          referrerSourceKey: requireText(cells, "indicador_id_externo", "ID Externo do Indicador", 200),
          referredSourceKey,
          reservationSourceKey: optionalText(cells, "reserva_id_externo", 200),
          code: requireText(cells, "codigo", "Código", 100),
          referredName,
          referredEmail,
          referredPhone,
          status,
          bonusAmount: parseBrazilMoney(cells.bonus || "0,00", "Bônus")!,
          bonusPaid,
          bonusPaidAt,
          convertedAt,
          source: optionalText(cells, "origem", 100) ?? "importacao",
          notes: optionalText(cells, "observacoes"),
        },
      };
    }
    if (entity === "commissions") {
      const status = enumValue(cells.status ?? "", "Status", ["pending", "approved", "paid", "cancelled"]);
      const paidAt = parseBrazilDate(cells.pago_em ?? "", "Pago em");
      if (status === "paid" && !paidAt) throw new Error("Pago em é obrigatório quando o status é paid.");
      const baseAmount = parseBrazilMoney(requireText(cells, "valor_base", "Valor Base", 40), "Valor Base")!;
      const commissionAmount = parseBrazilMoney(requireText(cells, "valor_comissao", "Valor da Comissão", 40), "Valor da Comissão")!;
      const commissionRate = parseBrazilMoney(cells.taxa_comissao ?? "", "Taxa da Comissão", true);
      const commissionType = cells.tipo_comissao
        ? enumValue(cells.tipo_comissao, "Tipo da Comissão", ["percentage", "fixed"])
        : null;
      if (baseAmount <= 0 || commissionAmount <= 0) throw new Error("Valor Base e Valor da Comissão devem ser maiores que zero.");
      if (commissionAmount > baseAmount) throw new Error("Valor da Comissão não pode ser maior que o Valor Base.");
      if (commissionType === "percentage" && commissionRate == null) {
        throw new Error("Taxa da Comissão é obrigatória para comissão percentage.");
      }
      if (commissionType === "percentage" && commissionRate != null) {
        const calculated = Math.round(baseAmount * commissionRate) / 100;
        if (Math.abs(calculated - commissionAmount) > 0.02) {
          throw new Error("Valor da Comissão não corresponde ao Valor Base e à Taxa informados.");
        }
      }
      return {
        line, sourceKey, label: sourceKey, action: "created",
        data: {
          sellerEmail: emailValue(requireText(cells, "vendedor_email", "E-mail do Vendedor", 320), "E-mail do Vendedor")!,
          reservationSourceKey: requireText(cells, "reserva_id_externo", "ID Externo da Reserva", 200),
          baseAmount,
          commissionAmount,
          commissionRate,
          commissionType,
          status,
          paidAt,
        },
      };
    }
    if (entity === "deals") {
      const clientSourceKey = optionalText(cells, "cliente_id_externo", 200);
      const leadName = optionalText(cells, "nome_lead");
      if (!clientSourceKey && !leadName) throw new Error("Informe o ID Externo do Cliente ou o Nome do Lead.");
      const status = enumValue(cells.status ?? "", "Status", ["open", "won", "lost"]);
      const lostReason = optionalText(cells, "motivo_perda");
      if (status === "lost" && !lostReason) throw new Error("Motivo da Perda é obrigatório quando o status é lost.");
      return {
        line, sourceKey, label: requireText(cells, "titulo", "Título"), action: "created",
        data: {
          pipelineId: requireText(cells, "pipeline_id", "ID do Pipeline", 200),
          stageId: requireText(cells, "etapa_id", "ID da Etapa", 200),
          ownerEmail: emailValue(requireText(cells, "responsavel_email", "E-mail do Responsável", 320), "E-mail do Responsável")!,
          title: requireText(cells, "titulo", "Título"),
          value: parseBrazilMoney(requireText(cells, "valor", "Valor", 40), "Valor")!,
          status,
          clientSourceKey,
          tripSourceKey: optionalText(cells, "viagem_id_externo", 200),
          reservationSourceKey: optionalText(cells, "reserva_id_externo", 200),
          leadName,
          leadEmail: emailValue(cells.email_lead ?? "", "E-mail do Lead", true),
          leadWhatsapp: parsePhone(cells.whatsapp_lead ?? "", "WhatsApp do Lead", true),
          expectedCloseDate: parseBrazilDate(cells.fechamento_previsto ?? "", "Fechamento Previsto"),
          closedAt: parseBrazilDate(cells.fechado_em ?? "", "Fechado em"),
          lostReason,
          source: optionalText(cells, "origem", 100) ?? "importacao",
          description: optionalText(cells, "descricao"),
        },
      };
    }
    const totalValue = parseBrazilMoney(requireText(cells, "valor_total", "Valor Total", 40), "Valor Total")!;
    const paidValue = parseBrazilMoney(cells.valor_pago || "0,00", "Valor Pago")!;
    if (paidValue > totalValue) throw new Error("Valor Pago não pode ser maior que o Valor Total.");
    const status = enumValue(cells.status, "Status", ["pending", "confirmed", "completed", "cancelled"]);
    const seats = (cells.assentos ?? "").split(";").map(value => value.trim()).filter(Boolean);
    if (OCCUPYING_RESERVATION_STATUSES.has(status) && seats.length === 0) {
      throw new Error("Assentos é obrigatório para reservas ativas.");
    }
    if (new Set(seats.map(normalizeKey)).size !== seats.length) {
      throw new Error("Assentos contém posições repetidas.");
    }
    return {
      line,
      sourceKey,
      label: sourceKey,
      action: "created",
      data: {
        clientSourceKey: requireText(cells, "cliente_id_externo", "ID Externo do Cliente", 200),
        tripSourceKey: requireText(cells, "viagem_id_externo", "ID Externo da Viagem", 200),
        status,
        totalValue,
        paidValue,
        seats,
        paymentMethod: cells.forma_pagamento
          ? enumValue(cells.forma_pagamento, "Forma de Pagamento", ["pix", "cash", "boleto", "bank_transfer", "credit_card", "debit_card"])
          : null,
        installments: positiveInteger(cells.parcelas ?? "", "Parcelas", 1),
        notes: optionalText(cells, "observacoes"),
      },
    };
  } catch (error) {
    return { line, action: "rejected", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function analyzeRows(
  queryDb: Pick<typeof db, "select">,
  tenantId: string,
  entity: SpreadsheetEntity,
  parsedRows: Array<{ line: number; cells: CellRow }>,
): Promise<ParsedEntityRow[]> {
  const ledgerRows = await queryDb.select().from(spreadsheetImportRecordsTable)
    .where(eq(spreadsheetImportRecordsTable.tenantId, tenantId));
  const ledger = new Map(ledgerRows.map(row => [`${row.entity}:${normalizeKey(row.sourceKey)}`, row.targetId]));
  const seen = new Set<string>();
  const rows = parsedRows.map(row => parseRow(entity, row.line, row.cells));

  const tenantClients = ["clients", "payments", "referrals", "deals"].includes(entity)
    ? await queryDb.select({ id: clientsTable.id, cpf: clientsTable.cpf }).from(clientsTable).where(eq(clientsTable.tenantId, tenantId))
    : [];
  const clientIds = new Set(tenantClients.map(row => row.id));
  const cpfTargets = new Map(tenantClients.filter(row => row.cpf).map(row => [row.cpf!, row.id]));
  const tenantTrips = ["trips", "reservations", "expenses", "deals"].includes(entity)
    ? await queryDb.select({
        id: tripsTable.id,
        importFingerprint: tripsTable.importFingerprint,
        totalCapacity: tripsTable.totalCapacity,
      }).from(tripsTable).where(eq(tripsTable.tenantId, tenantId))
    : [];
  const tripTargets = new Map(tenantTrips.filter(row => row.importFingerprint).map(row => [row.importFingerprint!, row.id]));
  const tripCapacities = new Map(tenantTrips.map(row => [row.id, row.totalCapacity]));
  const tripIds = new Set(tenantTrips.map(row => row.id));
  const tenantReservations = entity === "reservations"
    ? await queryDb.select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        tripId: reservationsTable.tripId,
        status: reservationsTable.status,
        seats: reservationsTable.seats,
      }).from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId))
    : [];
  const referencedReservations = ["payments", "commissions", "deals", "referrals"].includes(entity)
    ? await queryDb.select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        tripId: reservationsTable.tripId,
        totalValue: reservationsTable.totalValue,
      }).from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId))
    : [];
  const reservationById = new Map(referencedReservations.map(row => [row.id, row]));
  const tenantUsers = entity === "commissions" || entity === "deals"
    ? await queryDb.select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.tenantId, tenantId))
    : [];
  const userByEmail = new Map(tenantUsers.map(row => [normalizeKey(row.email), row.id]));
  const tenantStages = entity === "deals"
    ? await queryDb.select({ id: pipelineStagesTable.id, pipelineId: pipelineStagesTable.pipelineId })
        .from(pipelineStagesTable).where(eq(pipelineStagesTable.tenantId, tenantId))
    : [];
  const stageById = new Map(tenantStages.map(row => [row.id, row]));
  const tenantPipelines = entity === "deals"
    ? await queryDb.select({ id: pipelinesTable.id }).from(pipelinesTable).where(eq(pipelinesTable.tenantId, tenantId))
    : [];
  const pipelineIds = new Set(tenantPipelines.map(row => row.id));
  const tenantPayments = entity === "payments"
    ? await queryDb.select({
        id: paymentsTable.id,
        reservationId: paymentsTable.reservationId,
        amount: paymentsTable.amount,
        status: paymentsTable.status,
      }).from(paymentsTable).where(eq(paymentsTable.tenantId, tenantId))
    : [];
  const acceptedPaidByReservation = new Map<string, number>();
  const tenantCommissions = entity === "commissions"
    ? await queryDb.select({
        id: commissionsTable.id,
        reservationId: commissionsTable.reservationId,
        userId: commissionsTable.userId,
      }).from(commissionsTable).where(eq(commissionsTable.tenantId, tenantId))
    : [];
  const acceptedCommissionKeys = new Set<string>();
  const tenantDeals = entity === "deals"
    ? await queryDb.select({
        id: dealsTable.id,
        clientId: dealsTable.clientId,
        tripId: dealsTable.tripId,
        status: dealsTable.status,
      }).from(dealsTable).where(eq(dealsTable.tenantId, tenantId))
    : [];
  const acceptedOpenDealKeys = new Set<string>();
  const activeReservationTargets = new Map(
    tenantReservations
      .filter(row => row.clientId && !["cancelled", "refunded"].includes(row.status))
      .map(row => [`${row.clientId}:${row.tripId}`, row.id]),
  );
  const acceptedReservationSeats = new Map<string, { tripId: string; seats: string[] }>();

  for (const row of rows) {
    if (!row.sourceKey || row.action === "rejected") continue;
    const normalizedSource = normalizeKey(row.sourceKey);
    if (seen.has(normalizedSource)) {
      row.action = "rejected";
      row.reason = "ID Externo repetido no mesmo arquivo.";
      continue;
    }
    seen.add(normalizedSource);
    const targetId = ledger.get(`${entity}:${normalizedSource}`);
    if (targetId) {
      row.action = "updated";
      row.targetId = targetId;
    }
    if (entity === "clients" && row.data) {
      const cpfTarget = cpfTargets.get(String(row.data.cpf));
      if (cpfTarget && cpfTarget !== targetId) {
        row.action = "rejected";
        row.reason = "CPF já pertence a outro cliente desta agência e não corresponde a este ID Externo.";
      }
    }
    if (entity === "trips" && row.data) {
      const fingerprintTarget = tripTargets.get(String(row.data.importFingerprint));
      if (fingerprintTarget && fingerprintTarget !== targetId) {
        row.action = "rejected";
        row.reason = "Já existe outra viagem desta agência com o mesmo nome, destino e data de saída.";
      }
    }
    if (entity === "reservations" && row.data) {
      const clientId = ledger.get(`clients:${normalizeKey(String(row.data.clientSourceKey))}`);
      const tripId = ledger.get(`trips:${normalizeKey(String(row.data.tripSourceKey))}`);
      if (!clientId || !tripId) {
        row.action = "rejected";
        row.reason = !clientId && !tripId
          ? "Cliente e viagem não foram encontrados pelos IDs Externos informados."
          : !clientId
            ? "Cliente não foi encontrado pelo ID Externo informado."
            : "Viagem não foi encontrada pelo ID Externo informado.";
      } else {
        row.data.clientId = clientId;
        row.data.tripId = tripId;
        const conflictingReservationId = activeReservationTargets.get(`${clientId}:${tripId}`);
        if (
          OCCUPYING_RESERVATION_STATUSES.has(String(row.data.status))
          && conflictingReservationId
          && conflictingReservationId !== targetId
        ) {
          row.action = "rejected";
          row.reason = "O cliente já possui uma reserva ativa para esta viagem.";
        } else if (OCCUPYING_RESERVATION_STATUSES.has(String(row.data.status))) {
          const effectiveTargetId = targetId ?? `linha:${row.line}`;
          const occupiedByDatabase = tenantReservations
            .filter(existing =>
              existing.tripId === tripId
              && existing.id !== targetId
              && OCCUPYING_RESERVATION_STATUSES.has(existing.status),
            )
            .flatMap(existing => existing.seats);
          const occupiedByFile = [...acceptedReservationSeats.values()]
            .filter(accepted => accepted.tripId === tripId)
            .flatMap(accepted => accepted.seats);
          const occupied = new Set([...occupiedByDatabase, ...occupiedByFile].map(normalizeKey));
          const seats = row.data.seats as string[];
          const collision = seats.find(seat => occupied.has(normalizeKey(seat)));
          const capacity = tripCapacities.get(tripId);
          if (collision) {
            row.action = "rejected";
            row.reason = `O assento ${collision} já está ocupado nesta viagem.`;
          } else if (capacity == null) {
            row.action = "rejected";
            row.reason = "Viagem não foi encontrada nesta agência.";
          } else if (occupiedByDatabase.length + occupiedByFile.length + seats.length > capacity) {
            row.action = "rejected";
            row.reason = "A reserva excede a quantidade de assentos disponíveis na viagem.";
          } else {
            activeReservationTargets.set(`${clientId}:${tripId}`, effectiveTargetId);
            acceptedReservationSeats.set(effectiveTargetId, { tripId, seats });
          }
        }
      }
    }
    if (entity === "payments" && row.data) {
      const reservationSourceKey = row.data.reservationSourceKey as string | null;
      const clientSourceKey = row.data.clientSourceKey as string | null;
      const reservationId = reservationSourceKey ? ledger.get(`reservations:${normalizeKey(reservationSourceKey)}`) : undefined;
      const clientId = clientSourceKey ? ledger.get(`clients:${normalizeKey(clientSourceKey)}`) : undefined;
      if (reservationSourceKey && !reservationId) {
        row.action = "rejected";
        row.reason = "Reserva não foi encontrada pelo ID Externo informado. Importe reservas antes de pagamentos.";
      } else if (clientSourceKey && (!clientId || !clientIds.has(clientId))) {
        row.action = "rejected";
        row.reason = "Cliente não foi encontrado pelo ID Externo informado. Importe clientes antes de pagamentos.";
      } else if (reservationId && !reservationById.has(reservationId)) {
        row.action = "rejected";
        row.reason = "A referência importada aponta para uma reserva que não existe mais nesta agência.";
      } else if (reservationId && clientId && reservationById.get(reservationId)?.clientId !== clientId) {
        row.action = "rejected";
        row.reason = "A reserva informada não pertence ao cliente informado.";
      } else {
        row.data.reservationId = reservationId ?? null;
        row.data.clientId = clientId ?? reservationById.get(reservationId ?? "")?.clientId ?? null;
        if (reservationId && row.data.status === "paid") {
          const priorPaid = tenantPayments
            .filter(payment =>
              payment.reservationId === reservationId
              && payment.status === "paid"
              && payment.id !== targetId,
            )
            .reduce((sum, payment) => sum + Number(payment.amount), 0);
          const acceptedPaid = acceptedPaidByReservation.get(reservationId) ?? 0;
          const nextPaid = priorPaid + acceptedPaid + Number(row.data.amount);
          const totalValue = Number(reservationById.get(reservationId)?.totalValue ?? 0);
          if (nextPaid > totalValue + 0.009) {
            row.action = "rejected";
            row.reason = "O total de pagamentos pagos excede o valor da reserva.";
          } else {
            acceptedPaidByReservation.set(reservationId, acceptedPaid + Number(row.data.amount));
          }
        }
      }
    }
    if (entity === "expenses" && row.data) {
      const sourceKey = row.data.tripSourceKey as string | null;
      const tripId = sourceKey ? ledger.get(`trips:${normalizeKey(sourceKey)}`) : undefined;
      if (sourceKey && (!tripId || !tripIds.has(tripId))) {
        row.action = "rejected";
        row.reason = "Viagem não foi encontrada pelo ID Externo informado. Importe viagens antes de despesas.";
      } else {
        row.data.tripId = tripId ?? null;
      }
    }
    if (entity === "referrals" && row.data) {
      const referrerSourceKey = String(row.data.referrerSourceKey);
      const referredSourceKey = row.data.referredSourceKey as string | null;
      const reservationSourceKey = row.data.reservationSourceKey as string | null;
      const referrerId = ledger.get(`clients:${normalizeKey(referrerSourceKey)}`);
      const referredId = referredSourceKey ? ledger.get(`clients:${normalizeKey(referredSourceKey)}`) : undefined;
      const reservationId = reservationSourceKey ? ledger.get(`reservations:${normalizeKey(reservationSourceKey)}`) : undefined;
      if (!referrerId || !clientIds.has(referrerId)) {
        row.action = "rejected";
        row.reason = "Cliente indicador não foi encontrado. Importe clientes antes de indicações.";
      } else if (referredSourceKey && (!referredId || !clientIds.has(referredId))) {
        row.action = "rejected";
        row.reason = "Cliente indicado não foi encontrado pelo ID Externo informado.";
      } else if (reservationSourceKey && (!reservationId || !reservationById.has(reservationId))) {
        row.action = "rejected";
        row.reason = "Reserva não foi encontrada. Importe reservas antes das indicações convertidas.";
      } else if (["completed", "converted", "reversed"].includes(String(row.data.status)) && (!referredId || !reservationId)) {
        row.action = "rejected";
        row.reason = "Indicação convertida ou revertida exige cliente indicado e reserva explícitos.";
      } else if (reservationId && referredId && reservationById.get(reservationId)?.clientId !== referredId) {
        row.action = "rejected";
        row.reason = "A reserva informada não pertence ao cliente indicado.";
      } else {
        row.data.referrerId = referrerId;
        row.data.referredId = referredId ?? null;
        row.data.reservationId = reservationId ?? null;
      }
    }
    if (entity === "commissions" && row.data) {
      const reservationId = ledger.get(`reservations:${normalizeKey(String(row.data.reservationSourceKey))}`);
      const userId = userByEmail.get(normalizeKey(String(row.data.sellerEmail)));
      if (!reservationId || !reservationById.has(reservationId)) {
        row.action = "rejected";
        row.reason = "Reserva não foi encontrada. Importe reservas antes das comissões.";
      } else if (!userId) {
        row.action = "rejected";
        row.reason = "Vendedor não encontrado pelo e-mail exato nesta agência. Usuários ausentes não são recriados.";
      } else {
        const duplicateKey = `${reservationId}:${userId}`;
        const conflict = tenantCommissions.some(commission =>
          commission.reservationId === reservationId
          && commission.userId === userId
          && commission.id !== targetId,
        ) || acceptedCommissionKeys.has(duplicateKey);
        if (conflict) {
          row.action = "rejected";
          row.reason = "Já existe uma comissão para este vendedor e reserva.";
        } else {
          acceptedCommissionKeys.add(duplicateKey);
          row.data.reservationId = reservationId;
          row.data.userId = userId;
        }
      }
    }
    if (entity === "deals" && row.data) {
      const pipelineId = String(row.data.pipelineId);
      const stageId = String(row.data.stageId);
      const stage = stageById.get(stageId);
      const ownerId = userByEmail.get(normalizeKey(String(row.data.ownerEmail)));
      const clientSourceKey = row.data.clientSourceKey as string | null;
      const tripSourceKey = row.data.tripSourceKey as string | null;
      const reservationSourceKey = row.data.reservationSourceKey as string | null;
      const clientId = clientSourceKey ? ledger.get(`clients:${normalizeKey(clientSourceKey)}`) : undefined;
      const tripId = tripSourceKey ? ledger.get(`trips:${normalizeKey(tripSourceKey)}`) : undefined;
      const reservationId = reservationSourceKey ? ledger.get(`reservations:${normalizeKey(reservationSourceKey)}`) : undefined;
      const reservation = reservationId ? reservationById.get(reservationId) : undefined;
      if (!pipelineIds.has(pipelineId)) {
        row.action = "rejected";
        row.reason = "Pipeline não pertence à agência atual.";
      } else if (!stage || stage.pipelineId !== pipelineId) {
        row.action = "rejected";
        row.reason = "Etapa não pertence ao pipeline informado.";
      } else if (!ownerId) {
        row.action = "rejected";
        row.reason = "Responsável não encontrado pelo e-mail exato nesta agência. Usuários ausentes não são recriados.";
      } else if (clientSourceKey && (!clientId || !clientIds.has(clientId))) {
        row.action = "rejected";
        row.reason = "Cliente não foi encontrado pelo ID Externo informado.";
      } else if (tripSourceKey && (!tripId || !tripIds.has(tripId))) {
        row.action = "rejected";
        row.reason = "Viagem não foi encontrada pelo ID Externo informado.";
      } else if (reservationSourceKey && (!reservationId || !reservationById.has(reservationId))) {
        row.action = "rejected";
        row.reason = "Reserva não foi encontrada pelo ID Externo informado.";
      } else if (reservation && clientId && reservation.clientId !== clientId) {
        row.action = "rejected";
        row.reason = "A reserva informada não pertence ao cliente informado.";
      } else if (reservation && tripId && reservation.tripId !== tripId) {
        row.action = "rejected";
        row.reason = "A reserva informada não pertence à viagem informada.";
      } else {
        const effectiveClientId = clientId ?? reservation?.clientId ?? null;
        const effectiveTripId = tripId ?? reservation?.tripId ?? null;
        const duplicateKey = effectiveClientId && effectiveTripId ? `${effectiveClientId}:${effectiveTripId}` : null;
        const conflict = row.data.status === "open" && duplicateKey && (
          tenantDeals.some(deal =>
            deal.clientId === effectiveClientId
            && deal.tripId === effectiveTripId
            && deal.status === "open"
            && deal.id !== targetId,
          )
          || acceptedOpenDealKeys.has(duplicateKey)
        );
        if (conflict) {
          row.action = "rejected";
          row.reason = "Já existe uma negociação aberta para este cliente e viagem.";
        } else {
          if (row.data.status === "open" && duplicateKey) acceptedOpenDealKeys.add(duplicateKey);
          row.data.ownerId = ownerId;
          row.data.clientId = effectiveClientId;
          row.data.tripId = effectiveTripId;
          row.data.reservationId = reservationId ?? null;
        }
      }
    }
  }
  return rows;
}

function reportFromRows(entity: SpreadsheetEntity, filename: string, rows: ParsedEntityRow[]): SpreadsheetImportReport {
  return {
    entity,
    contractVersion: 1,
    filename,
    totalRows: rows.length,
    results: rows.map(({ line, sourceKey, label, action, reason, targetId }) => ({ line, sourceKey, label, action, reason, targetId })),
  };
}

async function upsertClient(tx: ImportTx, tenantId: string, userId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const values = {
    name: String(data.name),
    email: String(data.email),
    whatsapp: String(data.whatsapp),
    phone: data.phone as string | null,
    cpf: String(data.cpf),
    birthDate: data.birthDate as Date | null,
    addressCity: data.addressCity as string | null,
    addressState: data.addressState as string | null,
    status: String(data.status),
    observations: data.observations as string | null,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const updated = await tx.update(clientsTable).set(values)
      .where(and(eq(clientsTable.id, targetId), eq(clientsTable.tenantId, tenantId)))
      .returning({ id: clientsTable.id });
    if (!updated.length) throw new Error("Cliente associado ao ID Externo não existe mais nesta agência.");
  } else {
    await tx.insert(clientsTable).values({ id: targetId, tenantId, createdById: userId, ...values });
  }
}

function simpleSeatMap(totalCapacity: number): Record<string, unknown> {
  return Object.fromEntries(Array.from({ length: totalCapacity }, (_, index) => [
    String(index + 1),
    { row: Math.floor(index / 4) + 1, col: (index % 4) + 1, status: "available" },
  ]));
}

async function upsertTrip(tx: ImportTx, tenantId: string, userId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const values = {
    name: String(data.name),
    destination: String(data.destination),
    destinationCity: String(data.destinationCity),
    destinationState: String(data.destinationState),
    departureDate: data.departureDate as Date,
    returnDate: data.returnDate as Date | null,
    totalCapacity: Number(data.totalCapacity),
    priceAdult: String(data.priceAdult),
    priceChild: data.priceChild == null ? null : String(data.priceChild),
    type: String(data.type),
    category: String(data.category),
    status: String(data.status) as typeof tripsTable.$inferInsert.status,
    importFingerprint: String(data.importFingerprint),
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const updated = await tx.update(tripsTable).set(values)
      .where(and(eq(tripsTable.id, targetId), eq(tripsTable.tenantId, tenantId)))
      .returning({ id: tripsTable.id });
    if (!updated.length) throw new Error("Viagem associada ao ID Externo não existe mais nesta agência.");
    await syncTripCounters(tx, tenantId, targetId);
  } else {
    await tx.insert(tripsTable).values({
      id: targetId,
      tenantId,
      createdById: userId,
      slug: `${String(data.name).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${targetId.slice(0, 6)}`,
      availableSeats: Number(data.totalCapacity),
      seatMap: simpleSeatMap(Number(data.totalCapacity)),
      ...values,
    });
  }
}

async function syncTripCounters(tx: ImportTx, tenantId: string, tripId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE trips
    SET reserved_seats = counts.reserved,
        confirmed_seats = counts.confirmed,
        available_seats = trips.total_capacity - counts.reserved - counts.confirmed
    FROM (
      SELECT
        COALESCE(SUM(cardinality(seats)) FILTER (WHERE status = 'pending'), 0)::int AS reserved,
        COALESCE(SUM(cardinality(seats)) FILTER (WHERE status IN ('confirmed', 'completed')), 0)::int AS confirmed
      FROM reservations
      WHERE tenant_id = ${tenantId} AND trip_id = ${tripId}
    ) counts
    WHERE trips.id = ${tripId} AND trips.tenant_id = ${tenantId}
  `);
  const [trip] = await tx.select({ availableSeats: tripsTable.availableSeats }).from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId))).limit(1);
  if (!trip) throw new Error("Viagem não existe mais nesta agência.");
  if (trip.availableSeats < 0) throw new Error("A quantidade de assentos das reservas excede a capacidade da viagem.");
}

async function upsertReservation(
  tx: ImportTx,
  tenantId: string,
  userId: string,
  tenantPrefix: string,
  row: ParsedEntityRow,
  targetId: string,
): Promise<void> {
  const data = row.data!;
  const tripId = String(data.tripId);
  await tx.execute(sql`SELECT id FROM trips WHERE id = ${tripId} AND tenant_id = ${tenantId} FOR UPDATE`);
  const [trip] = await tx.select({ id: tripsTable.id, type: tripsTable.type, totalCapacity: tripsTable.totalCapacity }).from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId))).limit(1);
  const [client] = await tx.select({ id: clientsTable.id }).from(clientsTable)
    .where(and(eq(clientsTable.id, String(data.clientId)), eq(clientsTable.tenantId, tenantId))).limit(1);
  if (!trip || !client) throw new Error("Cliente ou viagem não pertence à agência atual.");
  const seats = data.seats as string[];
  const status = String(data.status);
  const occupying = OCCUPYING_RESERVATION_STATUSES.has(status);
  const existingReservations = await tx.select({
    id: reservationsTable.id,
    seats: reservationsTable.seats,
    status: reservationsTable.status,
  }).from(reservationsTable).where(and(
    eq(reservationsTable.tenantId, tenantId),
    eq(reservationsTable.tripId, tripId),
  ));
  const otherOccupiedSeats = new Set(
    existingReservations
      .filter(existing => existing.id !== targetId && OCCUPYING_RESERVATION_STATUSES.has(existing.status))
      .flatMap(existing => existing.seats.map(normalizeKey)),
  );
  if (occupying) {
    const collision = seats.find(seat => otherOccupiedSeats.has(normalizeKey(seat)));
    if (collision) throw new Error(`O assento ${collision} já está ocupado nesta viagem.`);
    const occupiedByOthers = existingReservations
      .filter(existing => existing.id !== targetId && OCCUPYING_RESERVATION_STATUSES.has(existing.status))
      .reduce((total, existing) => total + existing.seats.length, 0);
    if (occupiedByOthers + seats.length > trip.totalCapacity) {
      throw new Error("A reserva excede a quantidade de assentos disponíveis na viagem.");
    }
  }
  const values = {
    tripId,
    clientId: String(data.clientId),
    seats,
    totalValue: String(data.totalValue),
    paidValue: String(data.paidValue),
    balance: String(Number(data.totalValue) - Number(data.paidValue)),
    paymentMethod: data.paymentMethod as string | null,
    installments: Number(data.installments),
    status: String(data.status) as typeof reservationsTable.$inferInsert.status,
    notes: data.notes as string | null,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const [existing] = await tx.select({ tripId: reservationsTable.tripId }).from(reservationsTable)
      .where(and(eq(reservationsTable.id, targetId), eq(reservationsTable.tenantId, tenantId))).limit(1);
    if (!existing) throw new Error("Reserva associada ao ID Externo não existe mais nesta agência.");
    await tx.update(reservationsTable).set(values)
      .where(and(eq(reservationsTable.id, targetId), eq(reservationsTable.tenantId, tenantId)));
    await syncTripCounters(tx, tenantId, existing.tripId);
  } else {
    const typeCode = tripTypeToCode(trip.type);
    const yearMonth = getYearMonth();
    const sequence = await nextReservationSequence(tenantId, yearMonth, typeCode, tx);
    const reservationNumber = buildReservationNumber(tenantPrefix, typeCode, yearMonth, sequence);
    const voucherCode = generateVoucherCode();
    await tx.insert(reservationsTable).values({
      id: targetId,
      tenantId,
      createdById: userId,
      voucherCode,
      qrCode: `QR-${voucherCode}`,
      reservationNumber,
      ...values,
    });
  }
  await syncTripCounters(tx, tenantId, tripId);
}

async function upsertPayment(tx: ImportTx, tenantId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const [existing] = row.action === "updated"
    ? await tx.select({ clientId: paymentsTable.clientId, reservationId: paymentsTable.reservationId })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.id, targetId), eq(paymentsTable.tenantId, tenantId)))
        .limit(1)
    : [];
  if (row.action === "updated" && !existing) {
    throw new Error("Pagamento associado ao ID Externo não existe mais nesta agência.");
  }
  const reservationId = data.reservationId as string | null;
  if (reservationId && data.status === "paid") {
    const lockedResult = await tx.execute(sql`
      SELECT total_value
      FROM reservations
      WHERE id = ${reservationId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const locked = (lockedResult as unknown as { rows: Array<{ total_value: string }> }).rows[0];
    if (!locked) throw new Error("Reserva associada ao pagamento não existe mais nesta agência.");
    const paidResult = await tx.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0) AS prior_paid
      FROM payments
      WHERE reservation_id = ${reservationId}
        AND tenant_id = ${tenantId}
        AND status = 'paid'
        AND id <> ${targetId}
    `);
    const priorPaid = Number((paidResult as unknown as { rows: Array<{ prior_paid: string }> }).rows[0]?.prior_paid ?? 0);
    if (priorPaid + Number(data.amount) > Number(locked.total_value) + 0.009) {
      throw new Error("O total de pagamentos pagos excede o valor da reserva.");
    }
  }
  const values = {
    reservationId,
    clientId: data.clientId as string | null,
    type: String(data.type) as typeof paymentsTable.$inferInsert.type,
    category: String(data.category),
    description: data.description as string | null,
    amount: String(data.amount),
    status: String(data.status) as typeof paymentsTable.$inferInsert.status,
    paymentMethod: String(data.paymentMethod),
    dueDate: data.dueDate as Date,
    paidAt: data.paidAt as Date | null,
    installmentNumber: Number(data.installmentNumber),
    totalInstallments: Number(data.totalInstallments),
    notes: data.notes as string | null,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    await tx.update(paymentsTable).set(values)
      .where(and(eq(paymentsTable.id, targetId), eq(paymentsTable.tenantId, tenantId)))
  } else {
    await tx.insert(paymentsTable).values({ id: targetId, tenantId, ...values });
  }
  const reservationIds = new Set([existing?.reservationId, reservationId].filter((id): id is string => !!id));
  for (const id of reservationIds) await syncReservationPaymentStatus(id, tenantId, tx);
  const clientIds = new Set([existing?.clientId, values.clientId].filter((id): id is string => !!id));
  for (const clientId of clientIds) {
    await tx.execute(sql`
      UPDATE clients
      SET
        total_spent = (
          SELECT COALESCE(SUM(amount::numeric), 0)
          FROM payments
          WHERE client_id = ${clientId} AND tenant_id = ${tenantId} AND status = 'paid'
        ),
        outstanding_balance = (
          SELECT COALESCE(SUM(amount::numeric), 0)
          FROM payments
          WHERE client_id = ${clientId} AND tenant_id = ${tenantId} AND status IN ('pending', 'overdue')
        )
      WHERE id = ${clientId} AND tenant_id = ${tenantId}
    `);
  }
}

async function upsertExpense(tx: ImportTx, tenantId: string, userId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const values = {
    tripId: data.tripId as string | null,
    category: String(data.category),
    description: String(data.description),
    amount: String(data.amount),
    status: String(data.status) as typeof expensesTable.$inferInsert.status,
    paymentMethod: data.paymentMethod as string | null,
    dueDate: data.dueDate as Date,
    paymentDate: data.paymentDate as Date | null,
    notes: data.notes as string | null,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const updated = await tx.update(expensesTable).set(values)
      .where(and(eq(expensesTable.id, targetId), eq(expensesTable.tenantId, tenantId)))
      .returning({ id: expensesTable.id });
    if (!updated.length) throw new Error("Despesa associada ao ID Externo não existe mais nesta agência.");
  } else {
    await tx.insert(expensesTable).values({ id: targetId, tenantId, createdById: userId, ...values });
  }
}

async function upsertReferral(tx: ImportTx, tenantId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const values = {
    referrerId: String(data.referrerId),
    referredId: data.referredId as string | null,
    reservationId: data.reservationId as string | null,
    code: String(data.code),
    referredName: data.referredName as string | null,
    referredEmail: data.referredEmail as string | null,
    referredPhone: data.referredPhone as string | null,
    status: String(data.status),
    bonusAmount: String(data.bonusAmount),
    bonusPaid: Boolean(data.bonusPaid),
    bonusPaidAt: data.bonusPaidAt as Date | null,
    convertedAt: data.convertedAt as Date | null,
    source: String(data.source),
    notes: data.notes as string | null,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const updated = await tx.update(referralsTable).set(values)
      .where(and(eq(referralsTable.id, targetId), eq(referralsTable.tenantId, tenantId)))
      .returning({ id: referralsTable.id });
    if (!updated.length) throw new Error("Indicação associada ao ID Externo não existe mais nesta agência.");
  } else {
    await tx.insert(referralsTable).values({ id: targetId, tenantId, ...values });
  }
}

async function upsertCommission(tx: ImportTx, tenantId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  const conflicts = await tx.select({ id: commissionsTable.id }).from(commissionsTable).where(and(
    eq(commissionsTable.tenantId, tenantId),
    eq(commissionsTable.reservationId, String(data.reservationId)),
    eq(commissionsTable.userId, String(data.userId)),
  ));
  if (conflicts.some(conflict => conflict.id !== targetId)) {
    throw new Error("Já existe uma comissão para este vendedor e reserva.");
  }
  const values = {
    ruleId: null,
    userId: String(data.userId),
    reservationId: String(data.reservationId),
    baseAmount: String(data.baseAmount),
    commissionAmount: String(data.commissionAmount),
    commissionRate: data.commissionRate == null ? null : String(data.commissionRate),
    commissionType: data.commissionType as string | null,
    status: String(data.status) as typeof commissionsTable.$inferInsert.status,
    paidAt: data.paidAt as Date | null,
  };
  if (row.action === "updated") {
    const updated = await tx.update(commissionsTable).set(values)
      .where(and(eq(commissionsTable.id, targetId), eq(commissionsTable.tenantId, tenantId)))
      .returning({ id: commissionsTable.id });
    if (!updated.length) throw new Error("Comissão associada ao ID Externo não existe mais nesta agência.");
  } else {
    await tx.insert(commissionsTable).values({ id: targetId, tenantId, ...values });
  }
}

async function upsertDeal(tx: ImportTx, tenantId: string, row: ParsedEntityRow, targetId: string): Promise<void> {
  const data = row.data!;
  if (data.status === "open" && data.clientId && data.tripId) {
    const conflicts = await tx.select({ id: dealsTable.id }).from(dealsTable).where(and(
      eq(dealsTable.tenantId, tenantId),
      eq(dealsTable.clientId, String(data.clientId)),
      eq(dealsTable.tripId, String(data.tripId)),
      eq(dealsTable.status, "open"),
    ));
    if (conflicts.some(conflict => conflict.id !== targetId)) {
      throw new Error("Já existe uma negociação aberta para este cliente e viagem.");
    }
  }
  const values = {
    stageId: String(data.stageId),
    ownerId: String(data.ownerId),
    title: String(data.title),
    description: data.description as string | null,
    value: String(data.value),
    status: String(data.status) as typeof dealsTable.$inferInsert.status,
    clientId: data.clientId as string | null,
    tripId: data.tripId as string | null,
    reservationId: data.reservationId as string | null,
    leadName: data.leadName as string | null,
    leadEmail: data.leadEmail as string | null,
    leadWhatsapp: data.leadWhatsapp as string | null,
    expectedCloseDate: data.expectedCloseDate as Date | null,
    closedAt: data.closedAt as Date | null,
    lostReason: data.lostReason as string | null,
    source: String(data.source),
    autoCreated: false,
    updatedAt: new Date(),
  };
  if (row.action === "updated") {
    const updated = await tx.update(dealsTable).set(values)
      .where(and(eq(dealsTable.id, targetId), eq(dealsTable.tenantId, tenantId)))
      .returning({ id: dealsTable.id });
    if (!updated.length) throw new Error("Negociação associada ao ID Externo não existe mais nesta agência.");
  } else {
    await tx.insert(dealsTable).values({ id: targetId, tenantId, ...values });
  }
}

async function parseRequest(reqBody: unknown) {
  const request = UploadBody.safeParse(reqBody);
  if (!request.success) throw new ValidationError("Dados da importação inválidos.", "SPREADSHEET_IMPORT_INVALID_REQUEST");
  const content = safeBuffer(request.data.contentBase64);
  const parsed = await parseSpreadsheet(request.data.filename, content);
  const headerErrors = validateHeaders(request.data.entity, parsed.headers);
  if (headerErrors.length) throw new ValidationError(headerErrors.join(" "), "SPREADSHEET_IMPORT_INVALID_HEADERS");
  return { ...request.data, content, parsed };
}

router.get("/spreadsheet-imports/contracts/:entity", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) throw new ForbiddenError("Apenas administradores podem importar planilhas.", "FORBIDDEN_ROLE");
    const entity = EntitySchema.safeParse(req.params.entity);
    if (!entity.success) throw new ValidationError("Tipo de importação inválido.", "SPREADSHEET_IMPORT_ENTITY_INVALID");
    res.json(getSpreadsheetContract(entity.data));
  } catch (error) { next(error); }
});

router.get("/spreadsheet-imports/templates/:entity.:format", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) throw new ForbiddenError("Apenas administradores podem baixar modelos de importação.", "FORBIDDEN_ROLE");
    const entity = EntitySchema.safeParse(req.params.entity);
    const format = z.enum(["csv", "xlsx"]).safeParse(req.params.format);
    if (!entity.success || !format.success) throw new ValidationError("Modelo solicitado é inválido.", "SPREADSHEET_TEMPLATE_INVALID");
    const filename = `modelo_${entity.data}_v1.${format.data}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    if (format.data === "csv") {
      res.type("text/csv; charset=utf-8").send(createCsvTemplate(entity.data));
    } else {
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(await createXlsxTemplate(entity.data));
    }
  } catch (error) { next(error); }
});

router.post("/spreadsheet-imports/preview", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) throw new ForbiddenError("Apenas administradores podem validar planilhas.", "FORBIDDEN_ROLE");
    const request = await parseRequest(req.body);
    const fileHash = createHash("sha256").update(request.content).digest("hex");
    const [priorBatch] = await db.select({ report: spreadsheetImportBatchesTable.report }).from(spreadsheetImportBatchesTable)
      .where(and(
        eq(spreadsheetImportBatchesTable.tenantId, me.tenantId),
        eq(spreadsheetImportBatchesTable.entity, request.entity),
        eq(spreadsheetImportBatchesTable.fileHash, fileHash),
      )).limit(1);
    if (priorBatch) {
      res.json({
        fileHash,
        report: {
          ...priorBatch.report,
          filename: request.filename,
          results: priorBatch.report.results.map(row => ({
            ...row,
            action: "ignored" as const,
            reason: "Este mesmo arquivo já foi importado nesta agência.",
          })),
        },
      });
      return;
    }
    const rows = await analyzeRows(db, me.tenantId, request.entity, request.parsed.rows);
    if (request.entity === "clients" || request.entity === "trips") {
      applyPlanCapacity(rows, await getRemainingImportCapacity(db, me.tenantId, request.entity), request.entity);
    }
    res.json({ fileHash, report: reportFromRows(request.entity, request.filename, rows) });
  } catch (error) { next(error); }
});

router.post("/spreadsheet-imports/import", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) throw new ForbiddenError("Apenas administradores podem importar planilhas.", "FORBIDDEN_ROLE");
    const request = await parseRequest(req.body);
    if (!request.idempotencyKey) throw new ValidationError("A chave de idempotência é obrigatória.", "SPREADSHEET_IMPORT_IDEMPOTENCY_REQUIRED");
    const fileHash = createHash("sha256").update(request.content).digest("hex");
    const tenantPrefix = request.entity === "reservations" ? await getTenantReservationPrefix(me.tenantId) : "";

    type TransactionResult =
      | { kind: "conflict" }
      | { kind: "replay"; report: SpreadsheetImportReport; importId: string }
      | { kind: "done"; report: SpreadsheetImportReport; importId: string };
    const result = await db.transaction(async (tx): Promise<TransactionResult> => {
      await tx.execute(sql`SELECT id FROM tenants WHERE id = ${me.tenantId} FOR UPDATE`);
      const [existingBatch] = await tx.select().from(spreadsheetImportBatchesTable).where(and(
        eq(spreadsheetImportBatchesTable.tenantId, me.tenantId),
        eq(spreadsheetImportBatchesTable.entity, request.entity),
        eq(spreadsheetImportBatchesTable.idempotencyKey, request.idempotencyKey!),
      )).limit(1);
      if (existingBatch) {
        if (existingBatch.fileHash !== fileHash) return { kind: "conflict" };
        return { kind: "replay", report: existingBatch.report, importId: existingBatch.id };
      }

      const importId = generateId();
      const [sameFileBatch] = await tx.select({ report: spreadsheetImportBatchesTable.report }).from(spreadsheetImportBatchesTable)
        .where(and(
          eq(spreadsheetImportBatchesTable.tenantId, me.tenantId),
          eq(spreadsheetImportBatchesTable.entity, request.entity),
          eq(spreadsheetImportBatchesTable.fileHash, fileHash),
        )).limit(1);
      if (sameFileBatch) {
        const report: SpreadsheetImportReport = {
          ...sameFileBatch.report,
          filename: request.filename,
          results: sameFileBatch.report.results.map(row => ({
            ...row,
            action: "ignored",
            reason: "Este mesmo arquivo já foi importado nesta agência.",
          })),
        };
        await tx.insert(spreadsheetImportBatchesTable).values({
          id: importId,
          tenantId: me.tenantId,
          entity: request.entity,
          idempotencyKey: request.idempotencyKey!,
          fileHash,
          filename: request.filename,
          report,
          createdById: me.id,
        });
        return { kind: "done", report, importId };
      }

      const analyzed = await analyzeRows(tx, me.tenantId, request.entity, request.parsed.rows);
      const remainingCapacity = request.entity === "clients" || request.entity === "trips"
        ? await getRemainingImportCapacity(tx, me.tenantId, request.entity)
        : Number.POSITIVE_INFINITY;
      if (request.entity === "clients" || request.entity === "trips") {
        applyPlanCapacity(analyzed, remainingCapacity, request.entity);
      }
      const results: SpreadsheetImportRowResult[] = [];
      for (const row of analyzed) {
        if (!row.sourceKey || row.action === "rejected" || !row.data) {
          results.push({ line: row.line, sourceKey: row.sourceKey, label: row.label, action: "rejected", reason: row.reason ?? "Linha inválida." });
          continue;
        }
        const targetId = row.targetId ?? generateId();
        try {
          await tx.transaction(async rowTx => {
            if (request.entity === "clients") await upsertClient(rowTx, me.tenantId, me.id, row, targetId);
            else if (request.entity === "trips") await upsertTrip(rowTx, me.tenantId, me.id, row, targetId);
            else if (request.entity === "reservations") await upsertReservation(rowTx, me.tenantId, me.id, tenantPrefix, row, targetId);
            else if (request.entity === "payments") await upsertPayment(rowTx, me.tenantId, row, targetId);
            else if (request.entity === "expenses") await upsertExpense(rowTx, me.tenantId, me.id, row, targetId);
            else if (request.entity === "referrals") await upsertReferral(rowTx, me.tenantId, row, targetId);
            else if (request.entity === "commissions") await upsertCommission(rowTx, me.tenantId, row, targetId);
            else await upsertDeal(rowTx, me.tenantId, row, targetId);

            await rowTx.insert(spreadsheetImportRecordsTable).values({
              id: generateId(),
              tenantId: me.tenantId,
              entity: request.entity,
              sourceKey: normalizeKey(row.sourceKey!),
              targetId,
              lastBatchId: importId,
              lastLine: row.line,
            }).onConflictDoUpdate({
              target: [
                spreadsheetImportRecordsTable.tenantId,
                spreadsheetImportRecordsTable.entity,
                spreadsheetImportRecordsTable.sourceKey,
              ],
              set: { targetId, lastBatchId: importId, lastLine: row.line, updatedAt: new Date() },
            });
          });
          results.push({ line: row.line, sourceKey: row.sourceKey, label: row.label, action: row.action, targetId });
        } catch (error) {
          results.push({ line: row.line, sourceKey: row.sourceKey, label: row.label, action: "rejected", reason: error instanceof Error ? error.message : String(error) });
        }
      }
      const report: SpreadsheetImportReport = { entity: request.entity, contractVersion: 1, filename: request.filename, totalRows: analyzed.length, results };
      await tx.insert(spreadsheetImportBatchesTable).values({
        id: importId,
        tenantId: me.tenantId,
        entity: request.entity,
        idempotencyKey: request.idempotencyKey!,
        fileHash,
        filename: request.filename,
        report,
        createdById: me.id,
      });
      return { kind: "done", report, importId };
    });
    if (result.kind === "conflict") {
      res.status(409).json({ error: "A chave de importação já foi usada com outro arquivo.", code: "SPREADSHEET_IMPORT_IDEMPOTENCY_CONFLICT" });
      return;
    }
    res.json({ importId: result.importId, replayed: result.kind === "replay", report: result.report });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) { next(error); return; }
    next(new AppError(error instanceof Error ? error.message : "A importação falhou.", 500, "SPREADSHEET_IMPORT_FAILED"));
  }
});

export default router;