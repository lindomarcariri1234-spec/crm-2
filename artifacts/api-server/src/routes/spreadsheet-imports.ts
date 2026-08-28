import { createHash } from "node:crypto";
import { Router, type NextFunction } from "express";
import { z } from "zod";
import { and, count, eq, or, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  tripsTable,
  reservationsTable,
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
import {
  createCsvTemplate,
  createXlsxTemplate,
  getSpreadsheetContract,
  optionalText,
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

const EntitySchema = z.enum(["clients", "trips", "reservations"]);
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

  const tenantClients = entity === "clients"
    ? await queryDb.select({ id: clientsTable.id, cpf: clientsTable.cpf }).from(clientsTable).where(eq(clientsTable.tenantId, tenantId))
    : [];
  const cpfTargets = new Map(tenantClients.filter(row => row.cpf).map(row => [row.cpf!, row.id]));
  const tenantTrips = entity === "trips" || entity === "reservations"
    ? await queryDb.select({
        id: tripsTable.id,
        importFingerprint: tripsTable.importFingerprint,
        totalCapacity: tripsTable.totalCapacity,
      }).from(tripsTable).where(eq(tripsTable.tenantId, tenantId))
    : [];
  const tripTargets = new Map(tenantTrips.filter(row => row.importFingerprint).map(row => [row.importFingerprint!, row.id]));
  const tripCapacities = new Map(tenantTrips.map(row => [row.id, row.totalCapacity]));
  const tenantReservations = entity === "reservations"
    ? await queryDb.select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        tripId: reservationsTable.tripId,
        status: reservationsTable.status,
        seats: reservationsTable.seats,
      }).from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId))
    : [];
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
            else await upsertReservation(rowTx, me.tenantId, me.id, tenantPrefix, row, targetId);

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