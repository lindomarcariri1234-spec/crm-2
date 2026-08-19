import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { reservationsTable, passengersTable, tripsTable, clientsTable, storeCouponsTable, storesTable, storeOrdersTable, loyaltyMembersTable, loyaltyTransactionsTable, loyaltyProgramsTable, referralsTable, referralSettingsTable, referralCampaignsTable, dealsTable, tenantsTable, emailLogsTable, paymentsTable, commissionsTable, vehicleLayoutsTable, reservationInstallmentsTable, boardingLocationsTable } from "@workspace/db";
import { eq, and, sql, desc, asc, inArray, notInArray, or, ilike } from "drizzle-orm";
import { formatBRL } from "@workspace/shared";
import { generateId, generateVoucherCode } from "../lib/id";
import { getTenantReservationPrefix, tripTypeToCode, getYearMonth, nextReservationSequence, buildReservationNumber } from "../lib/reservation-number";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { deriveAgeCategory, getAgeYears, resolveChildAgeCategory, syncIsChildUnder7 } from "../lib/passenger";
import { CreateReservationBody, UpdateReservationBody, CreatePassengerBody, UpdatePassengerBody } from "@workspace/api-zod";
import { z } from "zod/v4";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { writeClientActivity } from "../lib/activities";
import { enqueueReservationConfirmationEmail, enqueueReservationCancellationEmail, enqueueNewBookingNotificationEmail, dispatchReferralReversedEmail } from "../queues/email-helpers";
import { dispatchWhatsAppReservationConfirmed, dispatchWhatsAppCadastroRealizado } from "../queues/whatsapp-helpers";
import { insertClientNotification } from "../lib/client-notifications";
import { enqueueCommissionSync } from "../queues/commission-sync-helper";
import { ADMIN_ROLES, MANAGEMENT_ROLES } from '../lib/tenant';
import { broadcastSeatUpdate } from "../lib/realtime";
import { sendPushNotification } from "../lib/push-notifications";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { applyDiscounts, computeBalance, computeEffectiveLoyaltyPoints, roundMoney } from "../lib/pricing";
import { applyActiveCampaignBonus } from "../lib/referral-campaigns";
import { calculateTier, loyaltyAwardPointsForReservation } from "../lib/loyalty-helpers";
import { ROLES, RESERVATION_STATUS, REFERRAL_STATUS, COMMISSION_STATUS, STORE_ORDER_STATUS, STORE_PAYMENT_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, hasPermission, RESOURCES, ACTIONS, type ReservationStatus } from "@workspace/permissions";
import { parseReservationStatus } from "../lib/status-validators";
import { moveDealToStage, cancelDealOnReservationCancellation } from "../services/pipeline-automation";
import { syncClientDeal } from "../services/pipeline-deal-sync";
import { recalculateClientFinancials } from "./payments.js";
import { detectAndNotifyTripOverlap } from "../lib/trip-overlap-notify";


const router = Router();

async function generateInstallments(
  reservationId: string,
  tenantId: string,
  totalValue: number,
  installmentCount: number,
  firstDueDateStr: string,
): Promise<void> {
  // Preserve paid installments — only delete and regenerate unpaid ones
  const existing = await db.select().from(reservationInstallmentsTable)
    .where(eq(reservationInstallmentsTable.reservationId, reservationId))
    .orderBy(asc(reservationInstallmentsTable.installmentNumber));

  const paidRows = existing.filter(r => r.paidAt != null);
  const paidAmount = paidRows.reduce((s, r) => s + Number(r.amount), 0);

  // Delete only unpaid installments
  await db.delete(reservationInstallmentsTable)
    .where(and(
      eq(reservationInstallmentsTable.reservationId, reservationId),
      sql`${reservationInstallmentsTable.paidAt} IS NULL`,
    ));

  const n = Math.max(1, installmentCount);
  const unpaidCount = Math.max(1, n - paidRows.length);
  const remainingValue = Math.max(0, totalValue - paidAmount);
  const base = Math.floor((remainingValue / unpaidCount) * 100) / 100;
  const remainder = roundMoney(remainingValue - base * unpaidCount);
  const startNumber = paidRows.length + 1;

  const firstDate = new Date(`${firstDueDateStr}T12:00:00Z`);
  const rows = [];
  for (let i = 0; i < unpaidCount; i++) {
    const dueDate = new Date(firstDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    const amount = i === 0 ? base + remainder : base;
    rows.push({
      id: generateId(),
      reservationId,
      tenantId,
      installmentNumber: startNumber + i,
      dueDate,
      amount: amount.toFixed(2),
    });
  }
  if (rows.length > 0) {
    await db.insert(reservationInstallmentsTable).values(rows);
  }
}

export type ConflictingTrip = {
  reservationId: string;
  reservationNumber: string | null;
  tripId: string;
  tripName: string;
  departureDate: string;
  returnDate: string | null;
};

type ReservationRelations = {
  trip?: typeof tripsTable.$inferSelect;
  client?: typeof clientsTable.$inferSelect;
  hasAutoRetry: boolean;
  numberingType: string | null;
  boardingLocationMap?: Map<string, { name: string; time?: string }>;
  conflictingTrips?: ConflictingTrip[];
};

function buildReservationView(r: typeof reservationsTable.$inferSelect, rel: ReservationRelations) {
  const { trip, client, hasAutoRetry, numberingType, boardingLocationMap } = rel;
  return {
    id: r.id,
    tripId: r.tripId,
    clientId: r.clientId,
    seats: r.seats ?? [],
    tripType: r.tripType,
    packageType: r.packageType,
    hasInsurance: r.hasInsurance,
    isGratuidade: r.isGratuidade,
    totalValue: Number(r.totalValue),
    paidValue: Number(r.paidValue),
    balance: Number(r.balance),
    paymentMethod: r.paymentMethod,
    installments: r.installments,
    commissionPercentage: r.commissionPercentage ? Number(r.commissionPercentage) : null,
    commissionAmount: r.commissionAmount ? Number(r.commissionAmount) : null,
    commissionSyncStatus: r.commissionSyncStatus ?? null,
    sellerId: r.sellerId ?? null,
    status: r.status,
    voucherCode: r.voucherCode,
    reservationNumber: r.reservationNumber ?? null,
    qrCode: r.qrCode,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    notes: r.notes,
    boardingLocationId: r.boardingLocationId ?? null,
    boardingLocation: (() => {
      if (!r.boardingLocationId || !trip) return null;
      const bps = (trip.boardingPoints ?? []) as Array<{ id: string; name: string; time?: string }>;
      const bp = bps.find(p => p.id === r.boardingLocationId);
      if (bp) return { name: bp.name, time: bp.time ?? null };
      const bl = boardingLocationMap?.get(r.boardingLocationId);
      if (bl) return { name: bl.name, time: bl.time ?? null };
      return null;
    })(),
    storeOrderId: r.storeOrderId ?? null,
    discountCouponCode: r.discountCouponCode ?? null,
    discountCouponAmount: r.discountCouponAmount != null ? Number(r.discountCouponAmount) : null,
    discountLoyaltyPoints: r.discountLoyaltyPoints ?? null,
    discountLoyaltyAmount: r.discountLoyaltyAmount != null ? Number(r.discountLoyaltyAmount) : null,
    discountReferralCode: r.discountReferralCode ?? null,
    discountReferralAmount: r.discountReferralAmount != null ? Number(r.discountReferralAmount) : null,
    discountTotal: r.discountTotal != null ? Number(r.discountTotal) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    hasAutoRetry,
    trip: trip ? {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      departureDate: trip.departureDate.toISOString(),
      availableSeats: trip.availableSeats,
      totalCapacity: trip.totalCapacity,
      status: trip.status,
      coverImage: trip.coverImage,
      numberingType,
    } : { id: r.tripId, name: "Unknown", destination: "", departureDate: new Date().toISOString(), availableSeats: 0, totalCapacity: 0, status: "unknown", numberingType: null },
    client: client ? {
      id: client.id,
      name: client.name,
      email: client.email,
      whatsapp: client.whatsapp,
      cpf: client.cpf ?? null,
      birthDate: client.birthDate?.toISOString() ?? null,
    } : { id: r.clientId, name: "Unknown", email: "", whatsapp: "", cpf: null, birthDate: null },
    conflictingTrips: rel.conflictingTrips ?? [],
  };
}

async function formatReservation(r: typeof reservationsTable.$inferSelect) {
  const [trip] = await db.select().from(tripsTable).where(and(eq(tripsTable.id, r.tripId), eq(tripsTable.tenantId, r.tenantId))).limit(1);
  const [client] = r.clientId ? await db.select().from(clientsTable).where(and(eq(clientsTable.id, r.clientId), eq(clientsTable.tenantId, r.tenantId))).limit(1) : [];
  const [autoRetryLog] = await db.select({ id: emailLogsTable.id })
    .from(emailLogsTable)
    .where(and(eq(emailLogsTable.reservationId, r.id), eq(emailLogsTable.isAutoRetry, true), eq(emailLogsTable.tenantId, r.tenantId)))
    .limit(1);
  const [layoutRow] = trip?.layoutId
    ? await db.select({ numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, r.tenantId)))
        .limit(1)
    : [undefined];
  return buildReservationView(r, {
    trip,
    client,
    hasAutoRetry: autoRetryLog !== undefined,
    numberingType: layoutRow?.numberingType ?? null,
  });
}

// Batch-format a page of reservations without per-row queries (avoids N+1):
// fetches all related trips, clients, auto-retry email logs and vehicle layouts
// in at most four queries regardless of page size.
async function batchFormatReservations(
  rows: (typeof reservationsTable.$inferSelect)[],
  tenantId: string,
) {
  if (rows.length === 0) return [];

  const tripIds = [...new Set(rows.map(r => r.tripId))];
  const clientIds = [...new Set(rows.map(r => r.clientId).filter((id): id is string => id != null))];
  const reservationIds = rows.map(r => r.id);

  const [trips, clients, autoRetryLogs, boardingLocations] = await Promise.all([
    tripIds.length
      ? db.select().from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), inArray(tripsTable.id, tripIds)))
      : Promise.resolve([] as (typeof tripsTable.$inferSelect)[]),
    clientIds.length
      ? db.select().from(clientsTable).where(and(eq(clientsTable.tenantId, tenantId), inArray(clientsTable.id, clientIds)))
      : Promise.resolve([] as (typeof clientsTable.$inferSelect)[]),
    db.selectDistinct({ reservationId: emailLogsTable.reservationId })
      .from(emailLogsTable)
      .where(and(
        eq(emailLogsTable.tenantId, tenantId),
        eq(emailLogsTable.isAutoRetry, true),
        inArray(emailLogsTable.reservationId, reservationIds),
      )),
    db.select({ id: boardingLocationsTable.id, name: boardingLocationsTable.name, departureTime: boardingLocationsTable.departureTime })
      .from(boardingLocationsTable)
      .where(eq(boardingLocationsTable.tenantId, tenantId)),
  ]);

  const tripMap = new Map(trips.map(t => [t.id, t]));
  const clientMap = new Map(clients.map(c => [c.id, c]));
  const autoRetrySet = new Set(autoRetryLogs.map(l => l.reservationId).filter((id): id is string => id != null));
  const boardingLocationMap = new Map(boardingLocations.map(bl => [bl.id, { name: bl.name, time: bl.departureTime ?? undefined }]));

  const layoutIds = [...new Set(trips.map(t => t.layoutId).filter((id): id is string => id != null))];
  const layouts = layoutIds.length
    ? await db.select({ id: vehicleLayoutsTable.id, numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.tenantId, tenantId), inArray(vehicleLayoutsTable.id, layoutIds)))
    : [];
  const layoutMap = new Map(layouts.map(l => [l.id, l.numberingType]));

  // Batch conflict detection: fetch ALL active reservations for the page's client set (with trip dates)
  // so we can flag cross-trip date overlaps without N+1 queries.
  const allClientActiveResRows = clientIds.length
    ? await db.select({
        id: reservationsTable.id,
        clientId: reservationsTable.clientId,
        tripId: reservationsTable.tripId,
        reservationNumber: reservationsTable.reservationNumber,
        tripName: tripsTable.name,
        departureDate: tripsTable.departureDate,
        returnDate: tripsTable.returnDate,
      })
      .from(reservationsTable)
      .innerJoin(
        tripsTable,
        and(eq(tripsTable.id, reservationsTable.tripId), eq(tripsTable.tenantId, reservationsTable.tenantId)),
      )
      .where(and(
        eq(reservationsTable.tenantId, tenantId),
        inArray(reservationsTable.clientId, clientIds),
        notInArray(reservationsTable.status, [RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED]),
      ))
    : [];

  // Index by clientId for O(1) lookup
  const clientActiveResMap = new Map<string, Array<{
    id: string; tripId: string; reservationNumber: string | null;
    tripName: string; departureDate: Date; returnDate: Date | null;
  }>>();
  for (const cr of allClientActiveResRows) {
    if (!cr.clientId) continue;
    const list = clientActiveResMap.get(cr.clientId) ?? [];
    list.push({ id: cr.id, tripId: cr.tripId, reservationNumber: cr.reservationNumber ?? null, tripName: cr.tripName, departureDate: cr.departureDate, returnDate: cr.returnDate });
    clientActiveResMap.set(cr.clientId, list);
  }

  return rows.map(r => {
    const trip = tripMap.get(r.tripId);
    const client = r.clientId ? clientMap.get(r.clientId) : undefined;
    const numberingType = trip?.layoutId ? (layoutMap.get(trip.layoutId) ?? null) : null;

    // Detect conflicting trips: other active reservations for this client whose dates overlap
    const conflictingTrips: ConflictingTrip[] = [];
    if (trip && r.clientId) {
      const targetEnd = trip.returnDate ?? trip.departureDate;
      for (const cr of (clientActiveResMap.get(r.clientId) ?? [])) {
        if (cr.tripId === r.tripId) continue;
        const crEnd = cr.returnDate ?? cr.departureDate;
        if (trip.departureDate <= crEnd && targetEnd >= cr.departureDate) {
          conflictingTrips.push({
            reservationId: cr.id,
            reservationNumber: cr.reservationNumber,
            tripId: cr.tripId,
            tripName: cr.tripName,
            departureDate: cr.departureDate.toISOString(),
            returnDate: cr.returnDate?.toISOString() ?? null,
          });
        }
      }
    }

    return buildReservationView(r, {
      trip,
      client,
      hasAutoRetry: autoRetrySet.has(r.id),
      numberingType,
      boardingLocationMap,
      conflictingTrips,
    });
  });
}

function formatPassenger(p: typeof passengersTable.$inferSelect) {
  return {
    id: p.id, reservationId: p.reservationId, name: p.name, cpf: p.cpf, rg: p.rg,
    birthDate: p.birthDate?.toISOString() ?? null, ageCategory: p.ageCategory,
    seatNumber: p.seatNumber, isChildUnder7: p.isChildUnder7,
    checkedInAt: p.checkedInAt?.toISOString() ?? null,
  };
}

const ValidateCouponBodySchema = z.object({
  code: z.string().min(1),
  subtotal: z.number().positive(),
});

router.post("/reservations/validate-coupon", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = ValidateCouponBodySchema.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const { code, subtotal } = parsed.data;
    const now = new Date();

    const stores = await db.select({ id: storesTable.id })
      .from(storesTable)
      .where(eq(storesTable.tenantId, me.tenantId));

    if (!stores.length) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: "Nenhuma loja encontrada para este tenant" });
      return;
    }

    const storeIds = stores.map(s => s.id);
    const [coupon] = await db.select().from(storeCouponsTable)
      .where(and(
        inArray(storeCouponsTable.storeId, storeIds),
        eq(storeCouponsTable.code, code),
        eq(storeCouponsTable.isActive, true),
      )).limit(1);

    if (!coupon) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: "Cupom inválido ou não encontrado" });
      return;
    }
    if (coupon.startsAt > now) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: "Cupom ainda não está ativo" });
      return;
    }
    if (coupon.expiresAt < now) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: "Cupom expirado" });
      return;
    }
    if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: "Limite de uso do cupom atingido" });
      return;
    }
    if (coupon.minPurchaseAmount != null && subtotal < Number(coupon.minPurchaseAmount)) {
      res.json({ valid: false, discountAmount: 0, couponCode: code, message: `Valor mínimo de compra: R$ ${Number(coupon.minPurchaseAmount).toFixed(2)}` });
      return;
    }

    let discountAmount = 0;
    if (coupon.type === "percentage") {
      discountAmount = subtotal * (Number(coupon.value) / 100);
    } else {
      discountAmount = Number(coupon.value);
    }
    if (coupon.maxDiscountAmount != null) {
      discountAmount = Math.min(discountAmount, Number(coupon.maxDiscountAmount));
    }
    discountAmount = Math.min(discountAmount, subtotal);

    res.json({ valid: true, discountAmount: roundMoney(discountAmount), couponCode: code, message: null });
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/stats", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const tenantCond = eq(reservationsTable.tenantId, me.tenantId);

    const [statsRow] = await db
      .select({
        total: sql<number>`count(*)`,
        confirmed: sql<number>`count(*) filter (where status = ${RESERVATION_STATUS.CONFIRMED})`,
        pending: sql<number>`count(*) filter (where status = ${RESERVATION_STATUS.PENDING})`,
        cancelled: sql<number>`count(*) filter (where status = ${RESERVATION_STATUS.CANCELLED})`,
        totalOutstanding: sql<number>`coalesce(sum(balance) filter (where status not in (${RESERVATION_STATUS.CANCELLED}, ${RESERVATION_STATUS.COMPLETED})), 0)`,
      })
      .from(reservationsTable)
      .where(tenantCond);

    res.json({
      total: Number(statsRow?.total ?? 0),
      confirmed: Number(statsRow?.confirmed ?? 0),
      pending: Number(statsRow?.pending ?? 0),
      cancelled: Number(statsRow?.cancelled ?? 0),
      totalOutstanding: Number(statsRow?.totalOutstanding ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // Clients are not permitted to export reservation data
    if (me.role === ROLES.CLIENT) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { tripId, clientId, status, search, createdById, dateFrom, dateTo, commissionSyncStatus, hasAutoRetry } = req.query as Record<string, string>;

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !ISO_DATE.test(dateFrom)) { next(new ValidationError("dateFrom must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }
    if (dateTo && !ISO_DATE.test(dateTo)) { next(new ValidationError("dateTo must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }

    const conditions: ReturnType<typeof eq>[] = [eq(reservationsTable.tenantId, me.tenantId)];
    if (tripId) conditions.push(eq(reservationsTable.tripId, tripId));
    if (status) conditions.push(eq(reservationsTable.status, parseReservationStatus(status)));
    if (commissionSyncStatus) conditions.push(eq(reservationsTable.commissionSyncStatus, commissionSyncStatus));
    if (createdById) conditions.push(eq(reservationsTable.createdById, createdById));
    if (hasAutoRetry === "true") {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${emailLogsTable} WHERE ${emailLogsTable.reservationId} = ${reservationsTable.id} AND ${emailLogsTable.isAutoRetry} = true)` as ReturnType<typeof eq>,
      );
    }
    if (dateFrom) conditions.push(sql`${reservationsTable.createdAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo) conditions.push(sql`${reservationsTable.createdAt} <= (${dateTo}::date + interval '1 day - 1 millisecond')` as ReturnType<typeof eq>);
    if (search) {
      const term = `%${search}%`;
      const matchingClients = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          or(
            ilike(clientsTable.name, term),
            ilike(clientsTable.email, term),
            ilike(clientsTable.whatsapp, term),
            ilike(clientsTable.cpf, term),
          ),
        ));
      const matchingClientIds = matchingClients.map(c => c.id);
      const voucherCondition = or(
        ilike(reservationsTable.voucherCode, term),
        ilike(reservationsTable.reservationNumber, term),
      ) as ReturnType<typeof eq>;
      if (matchingClientIds.length > 0) {
        conditions.push(or(voucherCondition, inArray(reservationsTable.clientId, matchingClientIds)) as ReturnType<typeof eq>);
      } else {
        conditions.push(voucherCondition);
      }
    }

    // Mirror the same row-level scoping as GET /reservations
    if (me.role === ROLES.SALES) {
      const sellerClients = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.createdById, me.id)));
      if (!sellerClients.length && !clientId) {
        // Sales rep has no clients — return empty CSV
        const BOM = "\uFEFF";
        const exportDate = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
        const exportHeaders = [
          "Nº Reserva", "Cliente", "E-mail", "WhatsApp", "CPF",
          "Viagem", "Data de Saída", "Assentos",
          "Valor Total (R$)", "Pago (R$)", "Saldo (R$)", "Método de Pagamento",
          "Status", "Origem", "E-mail Auto-reenviado", "Criado em",
        ];
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="reservas-${exportDate}.csv"`);
        res.send(BOM + exportHeaders.join(","));
        return;
      }
      const sellerClientIds = sellerClients.map(c => c.id);
      if (clientId) {
        if (!sellerClientIds.includes(clientId)) {
          const BOM = "\uFEFF";
          const exportDate = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
          const exportHeaders = [
            "Nº Reserva", "Cliente", "E-mail", "WhatsApp", "CPF",
            "Viagem", "Data de Saída", "Assentos",
            "Valor Total (R$)", "Pago (R$)", "Saldo (R$)", "Método de Pagamento",
            "Status", "Origem", "E-mail Auto-reenviado", "Criado em",
          ];
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="reservas-${exportDate}.csv"`);
          res.send(BOM + exportHeaders.join(","));
          return;
        }
        conditions.push(eq(reservationsTable.clientId, clientId));
      } else {
        conditions.push(inArray(reservationsTable.clientId, sellerClientIds));
      }
    } else if (clientId) {
      conditions.push(eq(reservationsTable.clientId, clientId));
    }

    const rows = await db
      .select({
        id: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        voucherCode: reservationsTable.voucherCode,
        status: reservationsTable.status,
        totalValue: reservationsTable.totalValue,
        paidValue: reservationsTable.paidValue,
        balance: reservationsTable.balance,
        paymentMethod: reservationsTable.paymentMethod,
        seats: reservationsTable.seats,
        storeOrderId: reservationsTable.storeOrderId,
        createdAt: reservationsTable.createdAt,
        clientName: clientsTable.name,
        clientEmail: clientsTable.email,
        clientWhatsapp: clientsTable.whatsapp,
        clientCpf: clientsTable.cpf,
        tripName: tripsTable.name,
        tripDepartureDate: tripsTable.departureDate,
      })
      .from(reservationsTable)
      .leftJoin(clientsTable, and(eq(reservationsTable.clientId, clientsTable.id), eq(clientsTable.tenantId, me.tenantId)))
      .leftJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .where(and(...conditions))
      .orderBy(desc(reservationsTable.createdAt));

    const autoRetryIds = rows.length > 0
      ? await db
          .select({ reservationId: emailLogsTable.reservationId })
          .from(emailLogsTable)
          .where(and(
            inArray(emailLogsTable.reservationId, rows.map(r => r.id)),
            eq(emailLogsTable.isAutoRetry, true),
          ))
          .groupBy(emailLogsTable.reservationId)
          .then(results => new Set(results.map(r => r.reservationId)))
      : new Set<string>();

    const STATUS_PT: Record<string, string> = {
      pending: "Pendente",
      confirmed: "Confirmada",
      completed: "Concluída",
      cancelled: "Cancelada",
    };
    const METHOD_PT: Record<string, string> = {
      pix: "PIX",
      credit_card: "Cartão de Crédito",
      debit_card: "Cartão de Débito",
      cash: "Dinheiro",
      bank_transfer: "Transferência",
      boleto: "Boleto",
    };

    const headers = [
      "Nº Reserva", "Cliente", "E-mail", "WhatsApp", "CPF",
      "Viagem", "Data de Saída", "Assentos",
      "Valor Total (R$)", "Pago (R$)", "Saldo (R$)", "Método de Pagamento",
      "Status", "Origem", "E-mail Auto-reenviado", "Criado em",
    ];

    const escapeCell = (v: string | null | undefined) => {
      if (v == null) return "";
      let s = String(v);
      // Neutralize CSV formula injection (Excel executes leading =, +, -, @, tab)
      if (s.length > 0 && /^[=+\-@\t]/.test(s)) {
        s = `'${s}`;
      }
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvRows = rows.map(r => [
      escapeCell(r.reservationNumber ?? r.voucherCode),
      escapeCell(r.clientName),
      escapeCell(r.clientEmail),
      escapeCell(r.clientWhatsapp),
      escapeCell(r.clientCpf),
      escapeCell(r.tripName),
      r.tripDepartureDate ? new Date(r.tripDepartureDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      escapeCell((r.seats as string[] | null)?.join(", ")),
      parseFloat(String(r.totalValue)).toFixed(2),
      parseFloat(String(r.paidValue)).toFixed(2),
      parseFloat(String(r.balance)).toFixed(2),
      escapeCell(METHOD_PT[r.paymentMethod ?? ""] ?? r.paymentMethod),
      escapeCell(STATUS_PT[r.status] ?? r.status),
      r.storeOrderId ? "Vitrine" : "Balcão",
      autoRetryIds.has(r.id) ? "Sim" : "Não",
      new Date(r.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    ].join(","));

    const BOM = "\uFEFF";
    const csv = BOM + [headers.join(","), ...csvRows].join("\r\n");

    const date = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="reservas-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ── Trip date-overlap check ──────────────────────────────────────────────────
// Must be declared BEFORE GET /reservations/:id so Express doesn't capture
// the literal path segment "trip-overlap" as an :id parameter.
router.get("/reservations/trip-overlap", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.CREATE)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }

    const { clientId, tripId } = req.query as Record<string, string>;
    if (!clientId || !tripId) { next(new ValidationError("clientId e tripId são obrigatórios", "VALIDATION_ERROR")); return; }

    // Load the target trip dates
    const [targetTrip] = await db.select({ departureDate: tripsTable.departureDate, returnDate: tripsTable.returnDate })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!targetTrip) { res.json({ data: [] }); return; }

    const targetEnd = targetTrip.returnDate ?? targetTrip.departureDate;

    // Find active reservations for this client in OTHER trips whose dates overlap
    const conflicts = await db.select({
      reservationId: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      tripId: reservationsTable.tripId,
      tripName: tripsTable.name,
      departureDate: tripsTable.departureDate,
      returnDate: tripsTable.returnDate,
    })
    .from(reservationsTable)
    .innerJoin(tripsTable, and(eq(tripsTable.id, reservationsTable.tripId), eq(tripsTable.tenantId, reservationsTable.tenantId)))
    .where(and(
      eq(reservationsTable.tenantId, me.tenantId),
      eq(reservationsTable.clientId, clientId),
      notInArray(reservationsTable.tripId, [tripId]),
      notInArray(reservationsTable.status, [RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED]),
      // Overlap: targetStart ≤ otherEnd  AND  targetEnd ≥ otherStart
      sql`${targetTrip.departureDate}::timestamptz <= COALESCE(${tripsTable.returnDate}, ${tripsTable.departureDate})` as ReturnType<typeof eq>,
      sql`${targetEnd}::timestamptz >= ${tripsTable.departureDate}` as ReturnType<typeof eq>,
    ));

    res.json({
      data: conflicts.map(c => ({
        reservationId: c.reservationId,
        reservationNumber: c.reservationNumber ?? null,
        tripId: c.tripId,
        tripName: c.tripName,
        departureDate: c.departureDate.toISOString(),
        returnDate: c.returnDate?.toISOString() ?? null,
      })),
    });
  } catch (err) { next(err); }
});

router.get("/reservations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const { tripId, clientId, status, search, createdById, dateFrom, dateTo, commissionSyncStatus, hasAutoRetry, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 500);
    const offset = (pageNum - 1) * limitNum;

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !ISO_DATE.test(dateFrom)) { next(new ValidationError("dateFrom must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }
    if (dateTo && !ISO_DATE.test(dateTo)) { next(new ValidationError("dateTo must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }

    const conditions: ReturnType<typeof eq>[] = [eq(reservationsTable.tenantId, me.tenantId)];
    if (tripId) conditions.push(eq(reservationsTable.tripId, tripId));
    if (status) conditions.push(eq(reservationsTable.status, parseReservationStatus(status)));
    if (commissionSyncStatus) conditions.push(eq(reservationsTable.commissionSyncStatus, commissionSyncStatus));
    if (createdById) conditions.push(eq(reservationsTable.createdById, createdById));
    if (hasAutoRetry === "true") {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${emailLogsTable} WHERE ${emailLogsTable.reservationId} = ${reservationsTable.id} AND ${emailLogsTable.isAutoRetry} = true)` as ReturnType<typeof eq>,
      );
    }
    if (dateFrom) conditions.push(sql`${reservationsTable.createdAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo) conditions.push(sql`${reservationsTable.createdAt} <= (${dateTo}::date + interval '1 day - 1 millisecond')` as ReturnType<typeof eq>);
    if (search) {
      const term = `%${search}%`;
      const matchingClients = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          or(
            ilike(clientsTable.name, term),
            ilike(clientsTable.email, term),
            ilike(clientsTable.whatsapp, term),
            ilike(clientsTable.cpf, term),
          ),
        ));
      const matchingClientIds = matchingClients.map(c => c.id);
      const voucherCondition = or(
        ilike(reservationsTable.voucherCode, term),
        ilike(reservationsTable.reservationNumber, term),
      ) as ReturnType<typeof eq>;
      if (matchingClientIds.length > 0) {
        conditions.push(or(voucherCondition, inArray(reservationsTable.clientId, matchingClientIds)) as ReturnType<typeof eq>);
      } else {
        conditions.push(voucherCondition);
      }
    }

    if (me.role === ROLES.CLIENT) {
      const [clientRecord] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);
      if (!clientRecord) {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
      conditions.push(eq(reservationsTable.clientId, clientRecord.id));
    } else if (me.role === ROLES.SALES) {
      const sellerClients = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.createdById, me.id)));
      if (!sellerClients.length && !clientId) {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
      const sellerClientIds = sellerClients.map(c => c.id);
      if (clientId) {
        if (!sellerClientIds.includes(clientId)) {
          res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
          return;
        }
        conditions.push(eq(reservationsTable.clientId, clientId));
      } else {
        conditions.push(inArray(reservationsTable.clientId, sellerClientIds));
      }
    } else if (clientId) {
      conditions.push(eq(reservationsTable.clientId, clientId));
    }

    const reservations = await db.select().from(reservationsTable)
      .where(and(...conditions))
      .orderBy(desc(reservationsTable.createdAt))
      .limit(limitNum).offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(...conditions));

    const data = await batchFormatReservations(reservations, me.tenantId);
    res.json({ data, total: Number(countResult?.count ?? 0), page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

router.post("/reservations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.CREATE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateReservationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [client] = await db.select().from(clientsTable)
      .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!client) { next(new ValidationError("Client not found or not in tenant", "VALIDATION_ERROR")); return; }

    // Duplicate reservation guard: block creation when the same client already has
    // an active (non-cancelled, non-refunded) reservation for the same trip.
    const [existingDup] = await db.select({
      id: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      status: reservationsTable.status,
    }).from(reservationsTable).where(and(
      eq(reservationsTable.tenantId, me.tenantId),
      eq(reservationsTable.clientId, parsed.data.clientId),
      eq(reservationsTable.tripId, parsed.data.tripId),
      notInArray(reservationsTable.status, [RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED]),
    )).limit(1);
    if (existingDup) {
      res.status(409).json({
        error: "Este cliente já possui uma reserva ativa nesta viagem. Cancele a reserva existente antes de criar uma nova.",
        code: "DUPLICATE_RESERVATION",
        existingReservationId: existingDup.id,
        existingReservationNumber: existingDup.reservationNumber,
      });
      return;
    }

    const baseValue = parsed.data.totalValue;
    const now = new Date();

    let serverCouponId: string | null = null;
    let serverCouponCode: string | null = null;
    let serverCouponAmount = 0;

    if (parsed.data.discountCouponCode) {
      const stores = await db.select({ id: storesTable.id })
        .from(storesTable).where(eq(storesTable.tenantId, me.tenantId));
      const storeIds = stores.map(s => s.id);
      const [coupon] = storeIds.length
        ? await db.select().from(storeCouponsTable).where(and(
            inArray(storeCouponsTable.storeId, storeIds),
            eq(storeCouponsTable.code, parsed.data.discountCouponCode),
            eq(storeCouponsTable.isActive, true),
          )).limit(1)
        : [];
      if (!coupon || coupon.startsAt > now || coupon.expiresAt < now ||
          (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) ||
          (coupon.minPurchaseAmount != null && baseValue < Number(coupon.minPurchaseAmount))) {
        next(new ValidationError("Cupom inválido ou expirado", "VALIDATION_ERROR")); return;
      }
      serverCouponId = coupon.id;
      serverCouponCode = coupon.code;
      if (coupon.type === "percentage") {
        serverCouponAmount = baseValue * (Number(coupon.value) / 100);
      } else {
        serverCouponAmount = Number(coupon.value);
      }
      if (coupon.maxDiscountAmount != null) serverCouponAmount = Math.min(serverCouponAmount, Number(coupon.maxDiscountAmount));
      serverCouponAmount = roundMoney(Math.min(serverCouponAmount, baseValue));
    }

    let serverLoyaltyMemberId: string | null = null;
    let serverLoyaltyPoints = 0;
    let serverLoyaltyAmount = 0;
    let serverRealPerPoint = 0;

    if (parsed.data.discountLoyaltyPoints && parsed.data.discountLoyaltyPoints > 0) {
      const [member] = await db.select().from(loyaltyMembersTable)
        .where(and(eq(loyaltyMembersTable.tenantId, me.tenantId), eq(loyaltyMembersTable.clientId, parsed.data.clientId)))
        .limit(1);
      if (!member) {
        next(new ValidationError("Cliente não é membro do programa de fidelidade", "VALIDATION_ERROR")); return;
      }
      const [program] = await db.select().from(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.id, member.programId)).limit(1);
      if (!program) {
        next(new ValidationError("Programa de fidelidade não encontrado", "VALIDATION_ERROR")); return;
      }
      const requestedPoints = parsed.data.discountLoyaltyPoints;
      const minRedeemPoints = program.minRedeemPoints ?? 1;
      if (requestedPoints < minRedeemPoints) {
        next(new ValidationError(`Mínimo de ${minRedeemPoints} pontos para resgate`, "VALIDATION_ERROR")); return;
      }
      if ((member.availablePoints ?? 0) < requestedPoints) {
        next(new ValidationError("Pontos de fidelidade insuficientes", "VALIDATION_ERROR")); return;
      }
      serverLoyaltyMemberId = member.id;
      serverLoyaltyPoints = requestedPoints;
      serverRealPerPoint = Number(program.realPerPoint ?? "0");
      serverLoyaltyAmount = roundMoney(requestedPoints * serverRealPerPoint);
    }

    let serverReferralCode: string | null = null;
    let serverReferralAmount = 0;
    let serverReferralBonusValue = 0;
    let serverReferralDiscountPct = 5;
    let serverReferralReferrerId: string | null = null;
    let serverReferralConversionAt: Date = new Date();

    if (parsed.data.discountReferralCode) {
      const upperCode = parsed.data.discountReferralCode.toUpperCase();
      // Look up referrer by permanent client referral code
      const [referrer] = await db.select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, me.tenantId),
          eq(clientsTable.referralCode, upperCode),
        )).limit(1);
      if (!referrer) {
        next(new ValidationError("Código de indicação inválido", "VALIDATION_ERROR")); return;
      }
      // Get discount/bonus from referral settings
      const [refSettings] = await db.select({
        discountValue: referralSettingsTable.discountValue,
        discountType: referralSettingsTable.discountType,
        bonusValue: referralSettingsTable.bonusValue,
        isActive: referralSettingsTable.isEnabled,
      }).from(referralSettingsTable)
        .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);
      if (refSettings && refSettings.isActive === false) {
        next(new ValidationError("Programa de indicação inativo", "VALIDATION_ERROR")); return;
      }
      serverReferralCode = upperCode;
      serverReferralReferrerId = referrer.id;
      // Discount for the referred customer (percentage of base value)
      serverReferralDiscountPct = Number(refSettings?.discountValue ?? "5");
      serverReferralAmount = roundMoney(baseValue * (serverReferralDiscountPct / 100));
      // Bonus earned by the referrer
      serverReferralBonusValue = Number(refSettings?.bonusValue ?? "10");

      // Apply active campaign bonus; capture timestamp for convertedAt consistency.
      // fixed_extra is a flat add-on; multiplier adjusts the base.
      serverReferralConversionAt = new Date();
      const campaignResult = await applyActiveCampaignBonus(db, me.tenantId, serverReferralBonusValue, serverReferralConversionAt);
      serverReferralBonusValue = campaignResult.adjustedBase + campaignResult.fixedExtra;
    }

    // Apply discounts in priority order: coupon → loyalty → referral
    const {
      appliedCoupon: appliedCouponAmount,
      appliedLoyalty: appliedLoyaltyAmount,
      appliedReferral: appliedReferralAmount,
      discountTotal: serverDiscountTotal,
      finalTotal: serverFinalTotal,
    } = applyDiscounts(baseValue, serverCouponAmount, serverLoyaltyAmount, serverReferralAmount);

    const effectiveLoyaltyPoints = computeEffectiveLoyaltyPoints(
      serverLoyaltyPoints,
      appliedLoyaltyAmount,
      serverRealPerPoint,
    );

    const id = generateId();
    const voucherCode = generateVoucherCode();
    const seatsCount = parsed.data.seats.length;
    const paidValueNum = Number(parsed.data.paidValue ?? 0);

    const tenantPrefix = await getTenantReservationPrefix(me.tenantId);
    const yearMonth = getYearMonth();

    type TxResult = { error: string; status: number; code?: string } | { ok: true };

    const txResult: TxResult = await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT id, available_seats, type FROM trips WHERE id = ${parsed.data.tripId} AND tenant_id = ${me.tenantId} FOR UPDATE`
      );
      // Drizzle's tx.execute() returns the raw node-postgres QueryResult; cast to access .rows
      const tripRow = (lockResult as unknown as { rows: Array<{ id: string; available_seats: number; type: string }> }).rows[0];
      if (!tripRow) return { error: "Trip not found or not in tenant", status: 400 };

      const availableSeats = Number(tripRow.available_seats);
      if (availableSeats < seatsCount) {
        return { error: "Não há vagas suficientes nesta viagem", status: 409, code: "RESERVATION_CONFLICT" };
      }

      if (serverCouponId) {
        const couponLock = await tx.execute(
          sql`SELECT id, usage_count, usage_limit FROM store_coupons WHERE id = ${serverCouponId} FOR UPDATE`
        );
        const couponRow = (couponLock as unknown as { rows: Array<{ id: string; usage_count: number; usage_limit: number | null }> }).rows[0];
        if (!couponRow) return { error: "Cupom não encontrado", status: 400 };
        if (couponRow.usage_limit != null && couponRow.usage_count >= couponRow.usage_limit) {
          return { error: "Limite de uso do cupom atingido", status: 400 };
        }
        await tx.update(storeCouponsTable).set({ usageCount: sql`usage_count + 1` })
          .where(eq(storeCouponsTable.id, serverCouponId));
      }

      const typeCode = tripTypeToCode(parsed.data.tripType ?? tripRow.type);
      const seq = await nextReservationSequence(me.tenantId, yearMonth, typeCode, tx);
      const reservationNumber = buildReservationNumber(tenantPrefix, typeCode, yearMonth, seq);

      await tx.insert(reservationsTable).values({
        id,
        tenantId: me.tenantId,
        tripId: parsed.data.tripId,
        clientId: parsed.data.clientId,
        seats: parsed.data.seats,
        tripType: parsed.data.tripType ?? null,
        packageType: parsed.data.packageType ?? null,
        hasInsurance: parsed.data.hasInsurance ?? false,
        isGratuidade: parsed.data.isGratuidade ?? false,
        totalValue: String(serverFinalTotal),
        paidValue: String(parsed.data.paidValue ?? 0),
        balance: String(computeBalance(serverFinalTotal, parsed.data.paidValue ?? 0)),
        paymentMethod: parsed.data.paymentMethod ?? null,
        installments: parsed.data.installments ?? 1,
        commissionPercentage: parsed.data.commissionPercentage ? String(parsed.data.commissionPercentage) : null,
        commissionAmount: parsed.data.commissionAmount ? String(parsed.data.commissionAmount) : null,
        sellerId: parsed.data.sellerId ?? null,
        boardingLocationId: parsed.data.boardingLocationId ?? null,
        status: paidValueNum >= serverFinalTotal ? RESERVATION_STATUS.CONFIRMED : RESERVATION_STATUS.PENDING,
        voucherCode,
        reservationNumber,
        qrCode: `QR-${voucherCode}`,
        notes: parsed.data.notes ?? null,
        createdById: me.id,
        discountCouponCode: appliedCouponAmount > 0 ? serverCouponCode : null,
        discountCouponAmount: appliedCouponAmount > 0 ? String(appliedCouponAmount) : null,
        discountLoyaltyPoints: effectiveLoyaltyPoints > 0 ? effectiveLoyaltyPoints : null,
        discountLoyaltyAmount: appliedLoyaltyAmount > 0 ? String(appliedLoyaltyAmount) : null,
        discountReferralCode: appliedReferralAmount > 0 ? serverReferralCode : null,
        discountReferralAmount: appliedReferralAmount > 0 ? String(appliedReferralAmount) : null,
        discountTotal: serverDiscountTotal > 0 ? String(serverDiscountTotal) : null,
      });

      // When a reservation is created with an upfront payment, persist a matching
      // payment row so client financials (totalSpent / outstandingBalance) are
      // recalculated correctly from the payments table.
      if (paidValueNum > 0) {
        await tx.insert(paymentsTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          reservationId: id,
          clientId: parsed.data.clientId,
          type: PAYMENT_TYPE.RECEIVABLE,
          category: "reservation",
          amount: String(paidValueNum),
          paymentMethod: parsed.data.paymentMethod ?? "pix",
          installmentNumber: 1,
          totalInstallments: parsed.data.installments ?? 1,
          dueDate: new Date(),
          paidAt: new Date(),
          status: PAYMENT_STATUS.PAID,
          description: `Pagamento da reserva ${reservationNumber}`,
        });
      }

      await tx.insert(passengersTable).values({
        id: generateId(),
        reservationId: id,
        name: client.name,
        cpf: client.cpf ?? null,
        rg: client.rg ?? null,
        birthDate: client.birthDate ?? null,
        ...(() => {
          // Compute ageCategory from flags, then derive isChildUnder7 atomically.
          const seatArg = parsed.data.seats[0] ?? null;
          const resolvedCat: string = parsed.data.isOnLap
            ? "baby"
            : parsed.data.isChildUnder7
              ? resolveChildAgeCategory(seatArg)
              : deriveAgeCategory(client.birthDate ?? null);
          return {
            ageCategory: resolvedCat,
            seatNumber: parsed.data.isOnLap ? null : seatArg,
            isChildUnder7: syncIsChildUnder7(resolvedCat),
          };
        })(),
        isPrimary: true,
      });

      // Create placeholder passengers for additional seats (seats 1..N-1)
      for (let i = 1; i < seatsCount; i++) {
        await tx.insert(passengersTable).values({
          id: generateId(),
          reservationId: id,
          name: "A preencher",
          cpf: null,
          rg: null,
          birthDate: null,
          ageCategory: "adult",
          seatNumber: parsed.data.seats[i] ?? null,
          isChildUnder7: false,
          isPrimary: false,
        });
      }

      await tx.update(tripsTable).set({
        reservedSeats: sql`reserved_seats + ${seatsCount}`,
        availableSeats: sql`available_seats - ${seatsCount}`,
      }).where(and(eq(tripsTable.id, parsed.data.tripId), eq(tripsTable.tenantId, me.tenantId)));

      if (serverLoyaltyMemberId && effectiveLoyaltyPoints > 0) {
        const memberLock = await tx.execute(
          sql`SELECT id, available_points FROM loyalty_members WHERE id = ${serverLoyaltyMemberId} FOR UPDATE`
        );
        const memberRow = (memberLock as unknown as { rows: Array<{ id: string; available_points: number }> }).rows[0];
        if (!memberRow || memberRow.available_points < effectiveLoyaltyPoints) {
          return { error: "Pontos de fidelidade insuficientes (corrida detectada)", status: 400 };
        }
        const loyaltyResult = await tx.execute(
          sql`UPDATE loyalty_members SET available_points = available_points - ${effectiveLoyaltyPoints} WHERE id = ${serverLoyaltyMemberId} AND available_points >= ${effectiveLoyaltyPoints}`
        );
        const loyaltyAffected = (loyaltyResult as unknown as { rowCount: number }).rowCount ?? 0;
        if (loyaltyAffected === 0) {
          return { error: "Pontos de fidelidade insuficientes", status: 400 };
        }
        await tx.insert(loyaltyTransactionsTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          memberId: serverLoyaltyMemberId,
          type: "redeem",
          points: -effectiveLoyaltyPoints,
          description: `Resgate de pontos na reserva ${voucherCode}`,
          referenceId: id,
          referenceType: "reservation",
        });
      }

      if (serverReferralCode && serverReferralReferrerId && appliedReferralAmount > 0) {
        // INVARIANT: Every completed referral created on the CRM path MUST carry a
        // reservationId so that reservation cancellation can find and reverse exactly
        // this record via reverseReferral(). The variable `id` is the reservation ID
        // that was just generated for this transaction — it is never null here.
        // Do NOT insert a completed referral without setting reservationId on this path.
        if (!id) throw new Error("Assertion failed: reservationId must be set before inserting a completed referral on the CRM path");
        await tx.insert(referralsTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          referrerId: serverReferralReferrerId,
          code: serverReferralCode,
          status: REFERRAL_STATUS.COMPLETED,
          source: "crm",
          referredId: parsed.data.clientId,
          reservationId: id,
          discountApplied: true,
          discountType: "percentage",
          discountValue: serverReferralDiscountPct.toFixed(2),
          discountAmount: appliedReferralAmount.toFixed(2),
          bonusAmount: serverReferralBonusValue.toFixed(2),
          convertedAt: serverReferralConversionAt,
        });
        // Update referrer client stats (earnings += referrer bonus)
        await tx.update(clientsTable)
          .set({
            totalReferrals: sql`COALESCE(total_referrals, 0) + 1`,
            successfulReferrals: sql`COALESCE(successful_referrals, 0) + 1`,
            referralEarnings: sql`COALESCE(referral_earnings, 0) + ${serverReferralBonusValue.toFixed(2)}`,
          })
          .where(eq(clientsTable.id, serverReferralReferrerId));
        // Update referred client: set referredById if not already set
        await tx.update(clientsTable)
          .set({ referredById: serverReferralReferrerId })
          .where(and(
            eq(clientsTable.id, parsed.data.clientId),
            sql`referred_by_id IS NULL`,
          ));
      }

      return { ok: true };
    });

    if ("error" in txResult) {
      next(new AppError(txResult.error, txResult.status, txResult.code ?? "RESERVATION_ERROR"));
      return;
    }

    // Recalculate client financials if an upfront payment was recorded
    if (paidValueNum > 0 && parsed.data.clientId) {
      try {
        await recalculateClientFinancials(parsed.data.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after reservation creation");
      }
    }

    const [reservation] = await db.select().from(reservationsTable)
      .where(and(eq(reservationsTable.id, id), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation) { next(new AppError("Failed to create reservation", 500, "RESERVATION_CREATE_FAILED")); return; }
    const formatted = await formatReservation(reservation);
    res.status(201).json(formatted);
    if (parsed.data.firstDueDate && (parsed.data.installments ?? 1) >= 1) {
      generateInstallments(id, me.tenantId, Number(reservation.totalValue), parsed.data.installments ?? 1, parsed.data.firstDueDate)
        .catch((err) => req.log.error({ err }, "Error generating installments on reservation create"));
    }
    broadcastSeatUpdate(reservation.tripId, me.tenantId).catch(() => {});
    CalendarSyncService.syncTrip(reservation.tripId)
      .catch((err) => req.log.warn({ err, context: "reservation.create", tripId: reservation.tripId, reservationId: id }, "Calendar sync falhou — continuando"));
    enqueueCommissionSync(id, me.tenantId)
      .catch((err) => req.log.error({ err }, "Error enqueuing commission sync after reservation creation"));
    if (reservation.clientId) {
      syncClientDeal(reservation.clientId, me.tenantId, reservation.tripId, Number(reservation.totalValue), me.id, id)
        .catch((err) => req.log.error({ err }, "Error syncing deal after reservation creation"));
      const totalFormatted = formatBRL(Number(reservation.totalValue));
      writeClientActivity(reservation.clientId, "reservation_created", `Reserva ${voucherCode} criada — ${totalFormatted}`, me.id, { voucherCode, totalValue: Number(reservation.totalValue) })
        .catch((err) => req.log.error({ err }, "Error writing reservation creation activity"));
      detectAndNotifyTripOverlap({
        reservationId: reservation.id,
        clientId: reservation.clientId,
        tripId: reservation.tripId,
        tenantId: me.tenantId,
        actorUserId: me.id,
      }).catch((err) => req.log.error({ err }, "Error in trip overlap detection after reservation creation"));
    }
    // Fire-and-forget: enqueue confirmation email + WhatsApp (never blocks reservation creation)
    ;(async () => {
      try {
        const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);
        if (!tenant) return;

        const dDate = formatted.trip.departureDate ? new Date(formatted.trip.departureDate) : null;
        const departureDate = dDate
          ? dDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })
          : "";

        // WhatsApp cadastro — fires for all new reservations (pending status = registration)
        if (reservation.status === RESERVATION_STATUS.PENDING) {
          dispatchWhatsAppCadastroRealizado({
            reservationId: reservation.id,
            tenantId: me.tenantId,
          }).catch((err) => req.log.warn({ err }, "[whatsapp] Cadastro realizado dispatch failed — non-fatal"));
        }

        // WhatsApp confirmation — only when reservation is already CONFIRMED at creation time;
        // pending->confirmed transitions are handled by PATCH isBeingConfirmed to avoid duplicates
        if (reservation.status === RESERVATION_STATUS.CONFIRMED) {
          dispatchWhatsAppReservationConfirmed({
            reservationId: reservation.id,
            tenantId: me.tenantId,
          }).catch((err) => req.log.warn({ err }, "[whatsapp] Reservation confirmed dispatch failed — non-fatal"));
        }

        // Email confirmation — only when the client has an email address
        const clientEmail = client?.email;
        if (!clientEmail) return;

        const totalVal = Number(reservation.totalValue);
        const paidVal = Number(reservation.paidValue);
        const balanceVal = Number(reservation.balance);
        const paymentStatus: typeof STORE_PAYMENT_STATUS.PAID | "partial" | typeof STORE_PAYMENT_STATUS.PENDING =
          paidVal >= totalVal ? STORE_PAYMENT_STATUS.PAID : paidVal > 0 ? "partial" : STORE_PAYMENT_STATUS.PENDING;
        const [tripRecord] = await db.select().from(tripsTable).where(eq(tripsTable.id, reservation.tripId)).limit(1);
        let duration = "";
        if (dDate && tripRecord?.returnDate) {
          const diffMs = tripRecord.returnDate.getTime() - dDate.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays > 0) duration = `${diffDays} dia${diffDays !== 1 ? "s" : ""}`;
        }
        const agencyPhone = tenant.whatsapp ?? tenant.phone ?? "";
        const agencyWebsite = tenant.website ?? `https://${tenant.slug}.visitecrm.com.br`;
        const whatsappNum = agencyPhone.replace(/\D/g, "");
        const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : "";
        const publicBase = agencyWebsite.replace(/\/$/, "");
        const voucherUrl = `${publicBase}/reserva/${reservation.voucherCode}`;
        const consultUrl = `${publicBase}/reservas`;
        const profileUrl = `${publicBase}/perfil?tab=reservas`;
        const subject = `Reserva Confirmada — ${reservation.reservationNumber ?? reservation.voucherCode}`;
        await enqueueReservationConfirmationEmail({
          tenantId: me.tenantId,
          reservationId: reservation.id,
          subject,
          props: {
            reservationNumber: reservation.reservationNumber ?? reservation.voucherCode,
            voucherCode: reservation.voucherCode,
            clientName: client?.name ?? "",
            clientCpf: client?.cpf ?? "",
            clientEmail,
            clientPhone: client?.whatsapp ?? "",
            tripTitle: formatted.trip.name,
            destination: formatted.trip.destination,
            departureDate,
            duration,
            seats: (reservation.seats ?? []) as string[],
            totalAmount: totalVal,
            amountPaid: paidVal,
            amountPending: balanceVal,
            paymentMethod: reservation.paymentMethod ?? "pix",
            paymentStatus,
            agencyName: tenant.name,
            agencyLogo: tenant.logoUrl ?? "",
            agencyPhone,
            agencyPhoneVoice: tenant.phone ?? "",
            agencyEmail: tenant.email,
            agencyWebsite,
            voucherUrl,
            consultUrl,
            profileUrl,
            whatsappUrl,
          },
        });
        req.log.info({ reservationId: reservation.id }, "Reservation confirmation email enqueued");
      } catch (err) {
        req.log.error({ err }, "Error enqueuing reservation confirmation email/WhatsApp");
      }
    })();
  } catch (err) {
    // Race-condition safety net: two simultaneous POST /api/reservations for the
    // same client+trip can both pass the pre-insert duplicate check, then the
    // second INSERT is blocked by the partial unique index (migration 0042,
    // reservations_active_client_trip_unique).  PostgreSQL surfaces this as a
    // UNIQUE_VIOLATION (code 23505).  Convert it to a structured 409 so callers
    // receive the same DUPLICATE_RESERVATION contract as the pre-check path.
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505" &&
      "constraint" in err &&
      (err as { constraint: string }).constraint === "reservations_active_client_trip_unique"
    ) {
      next(new ConflictError(
        "Este cliente já possui uma reserva ativa nesta viagem (conflito detectado durante a criação).",
        "DUPLICATE_RESERVATION",
      ));
      return;
    }
    next(err);
  }
});

async function requireReservationAccess(
  me: { id: string; tenantId: string; role: string },
  reservationId: string,
): Promise<typeof reservationsTable.$inferSelect> {
  const [reservation] = await db.select().from(reservationsTable)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, me.tenantId)))
    .limit(1);
  if (!reservation) throw new NotFoundError("Reservation not found", "RESERVATION_NOT_FOUND");
  if (me.role === ROLES.CLIENT) {
    const [clientRecord] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id))).limit(1);
    if (!clientRecord || reservation.clientId !== clientRecord.id) {
      throw new NotFoundError("Reservation not found", "RESERVATION_NOT_FOUND");
    }
  } else if (me.role === ROLES.SALES) {
    const [clientRecord] = await db.select({ createdById: clientsTable.createdById }).from(clientsTable)
      .where(and(eq(clientsTable.id, reservation.clientId!), eq(clientsTable.tenantId, me.tenantId))).limit(1);
    if (!clientRecord || clientRecord.createdById !== me.id) {
      throw new NotFoundError("Reservation not found", "RESERVATION_NOT_FOUND");
    }
  }
  return reservation;
}

router.get("/reservations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const reservation = await requireReservationAccess(me, req.params.id);
    const formatted = await formatReservation(reservation);
    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

const CANCELLING_STATUSES: readonly ReservationStatus[] = [RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED] as const;
const ACTIVE_STATUSES: readonly ReservationStatus[] = [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED] as const;

router.patch("/reservations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await requireReservationAccess(me, req.params.id);

    const parsed = UpdateReservationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const updates: Partial<typeof reservationsTable.$inferInsert> = {};
    if (parsed.data.status != null) updates.status = parseReservationStatus(parsed.data.status);
    if (parsed.data.paymentMethod != null) updates.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    if (parsed.data.seats != null) updates.seats = parsed.data.seats;
    if (parsed.data.installments != null) updates.installments = parsed.data.installments;
    if (parsed.data.boardingLocationId !== undefined) updates.boardingLocationId = parsed.data.boardingLocationId ?? null;
    if (parsed.data.totalValue != null) {
      const newTotal = String(parsed.data.totalValue);
      const paidValue = Number(existing.paidValue);
      updates.totalValue = newTotal;
      updates.balance = String(computeBalance(parsed.data.totalValue, paidValue));
    }
    if (parsed.data.commissionAmount !== undefined) updates.commissionAmount = parsed.data.commissionAmount != null ? String(parsed.data.commissionAmount) : null;
    if (parsed.data.sellerId !== undefined) updates.sellerId = parsed.data.sellerId ?? null;
    if (parsed.data.discountTotal !== undefined) updates.discountTotal = parsed.data.discountTotal != null ? String(parsed.data.discountTotal) : null;
    if (parsed.data.isGratuidade !== undefined && parsed.data.isGratuidade !== null) updates.isGratuidade = parsed.data.isGratuidade;

    const newTripId = parsed.data.tripId ?? undefined;
    const newClientId = parsed.data.clientId ?? undefined;
    const tripChanged = newTripId != null && newTripId !== existing.tripId;
    const clientChanged = newClientId != null && newClientId !== existing.clientId;

    if (tripChanged || clientChanged) {
      if (tripChanged) {
        const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
          .where(and(eq(tripsTable.id, newTripId), eq(tripsTable.tenantId, me.tenantId)))
          .limit(1);
        if (!trip) { next(new ValidationError("Trip not found", "TRIP_NOT_FOUND")); return; }
        updates.tripId = newTripId;
      }
      if (clientChanged) {
        const [client] = await db.select({ id: clientsTable.id }).from(clientsTable)
          .where(and(eq(clientsTable.id, newClientId), eq(clientsTable.tenantId, me.tenantId)))
          .limit(1);
        if (!client) { next(new ValidationError("Client not found", "CLIENT_NOT_FOUND")); return; }
        updates.clientId = newClientId;
      }
    }

    const isBeingCancelled = parsed.data.status != null && CANCELLING_STATUSES.includes(parsed.data.status);
    const wasActive = ACTIVE_STATUSES.includes(existing.status);
    const wasConfirmed = existing.status === RESERVATION_STATUS.CONFIRMED;
    const isBeingConfirmed = parsed.data.status === RESERVATION_STATUS.CONFIRMED && existing.status === RESERVATION_STATUS.PENDING;
    const isBeingDemoted = parsed.data.status === RESERVATION_STATUS.PENDING && wasConfirmed;

    let reversedReferralInfo: { referrerId: string; referredId: string | null; bonusAmount: string } | null = null;

    const reservation = await db.transaction(async (tx) => {
      if (isBeingCancelled && wasActive) {
        const seatsCount = existing.seats.length;
        if (seatsCount > 0) {
          await tx.update(tripsTable).set({
            availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
            ...(wasConfirmed
              ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})` }
              : { reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})` }),
          }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
        }

        // --- Reversal 1: coupon usage_count ---
        // Two-step lookup mirrors creation: find exact coupon ID by code+store,
        // then decrement by ID — symmetric with creation's WHERE id = serverCouponId.
        // Idempotency: if couponReversalAt is already set on the reservation, the
        // decrement was already applied in a prior cancellation attempt (e.g. the
        // reservation was reopened by an admin and is being cancelled again). Skip
        // the decrement to prevent double-counting.
        if (existing.discountCouponCode && !existing.couponReversalAt) {
          const [store] = await tx.select({ id: storesTable.id })
            .from(storesTable)
            .where(eq(storesTable.tenantId, me.tenantId))
            .limit(1);
          if (store) {
            const [coupon] = await tx.select({ id: storeCouponsTable.id })
              .from(storeCouponsTable)
              .where(and(
                eq(storeCouponsTable.storeId, store.id),
                eq(storeCouponsTable.code, existing.discountCouponCode),
              ))
              .limit(1);
            if (coupon) {
              await tx.update(storeCouponsTable)
                .set({ usageCount: sql`GREATEST(0, usage_count - 1)` })
                .where(eq(storeCouponsTable.id, coupon.id));
              updates.couponReversalAt = new Date();
            }
          }
        }

        // --- Reversal 2: loyalty points used as discount ---
        const loyaltyPointsToRestore = existing.discountLoyaltyPoints ?? 0;
        if (loyaltyPointsToRestore > 0 && existing.clientId) {
          await tx.execute(
            sql`SELECT id FROM loyalty_members WHERE tenant_id = ${me.tenantId} AND client_id = ${existing.clientId} LIMIT 1 FOR UPDATE`
          );
          const [loyaltyMember] = await tx
            .select({ id: loyaltyMembersTable.id, availablePoints: loyaltyMembersTable.availablePoints })
            .from(loyaltyMembersTable)
            .where(and(
              eq(loyaltyMembersTable.tenantId, me.tenantId),
              eq(loyaltyMembersTable.clientId, existing.clientId),
            ))
            .limit(1);
          if (loyaltyMember) {
            // Idempotency: skip if a "refund" transaction for this reservation already exists
            // (prevents double-reversal on reopen → re-cancel flows)
            const [existingRefund] = await tx
              .select({ id: loyaltyTransactionsTable.id })
              .from(loyaltyTransactionsTable)
              .where(and(
                eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
                eq(loyaltyTransactionsTable.type, "refund"),
                eq(loyaltyTransactionsTable.referenceId, req.params.id),
              ))
              .limit(1);
            if (!existingRefund) {
              await tx.update(loyaltyMembersTable)
                .set({
                  availablePoints: loyaltyMember.availablePoints + loyaltyPointsToRestore,
                  lastActivityAt: new Date(),
                })
                .where(eq(loyaltyMembersTable.id, loyaltyMember.id));
              await tx.insert(loyaltyTransactionsTable).values({
                id: generateId(),
                tenantId: me.tenantId,
                memberId: loyaltyMember.id,
                type: "refund",
                points: loyaltyPointsToRestore,
                description: `Estorno de pontos — cancelamento da reserva ${existing.voucherCode}`,
                referenceId: req.params.id,
                referenceType: "reservation",
              });
            }
          }
        }

        // --- Reversal 3: referral bonus credited to referrer ---
        // Idempotency: explicit timestamp guard (`referralReversalAt`) fires first —
        // if already set, the entire lookup tree is skipped, preventing any DB reads
        // and double-reversal on reopen → re-cancel flows. This mirrors the
        // `couponReversalAt` pattern used by Reversal 1.
        //
        // Secondary (implicit) guard: both lookup branches filter on `status = COMPLETED`.
        // If the referral record is already REVERSED (and `referralReversalAt` was somehow
        // not set — e.g. legacy data), the COMPLETED-filtered queries return no rows and
        // `referralRecord` stays undefined, so the update block is naturally skipped.
        //
        // Lookup by reservationId (set for all storefront and CRM bookings).
        if (existing.discountReferralCode && !existing.referralReversalAt) {
          let referralRecord: { id: string; referrerId: string; referredId: string | null; bonusAmount: string } | undefined;

          const [byReservation] = await tx
            .select({ id: referralsTable.id, referrerId: referralsTable.referrerId, referredId: referralsTable.referredId, bonusAmount: referralsTable.bonusAmount })
            .from(referralsTable)
            .where(and(
              eq(referralsTable.tenantId, me.tenantId),
              eq(referralsTable.reservationId, req.params.id),
              eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
            ))
            .limit(1);

          if (byReservation) {
            referralRecord = byReservation;
          } else {
            // Secondary lookup: find any COMPLETED referral for this code
            // (ignoring reservationId) to distinguish a data integrity gap from
            // an already-reversed idempotency case.  If a COMPLETED row exists
            // for the code but has a different (or missing) reservation_id, that
            // is a gap worth surfacing to operators; if nothing exists the
            // referral was already reversed and silence is correct.
            const [byCode] = await tx
              .select({ id: referralsTable.id, referrerId: referralsTable.referrerId })
              .from(referralsTable)
              .where(and(
                eq(referralsTable.tenantId, me.tenantId),
                eq(referralsTable.code, existing.discountReferralCode),
                eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
              ))
              .limit(1);

            if (byCode) {
              req.log.warn(
                {
                  tenantId: me.tenantId,
                  referrerId: byCode.referrerId,
                  referralCode: existing.discountReferralCode,
                  reservationId: req.params.id,
                  reason: "missing_reservation_id",
                },
                "Referral reversal skipped: COMPLETED referral found by code but no record matches reservationId — possible missing reservation_id on referral row",
              );
            } else {
              // Both COMPLETED lookups returned nothing.  Distinguish a
              // re-cancel flow (referral already REVERSED — expected,
              // idempotent) from a reservation that was never linked to a
              // referral record (e.g. legacy data, or code applied after
              // conversion).  A third query checks for the REVERSED row so
              // operators can tell the two cases apart in logs.
              const [alreadyReversed] = await tx
                .select({ id: referralsTable.id })
                .from(referralsTable)
                .where(and(
                  eq(referralsTable.tenantId, me.tenantId),
                  eq(referralsTable.code, existing.discountReferralCode),
                  eq(referralsTable.status, REFERRAL_STATUS.REVERSED),
                ))
                .limit(1);

              if (alreadyReversed) {
                req.log.debug(
                  {
                    tenantId: me.tenantId,
                    referralCode: existing.discountReferralCode,
                    reservationId: req.params.id,
                    reason: "already_reversed",
                  },
                  "Referral reversal skipped: record is already REVERSED — expected re-cancel idempotency, no action needed",
                );
              } else {
                // Neither a COMPLETED nor a REVERSED referral row exists for
                // this code.  Before assuming the legitimate legacy case (a
                // discount code applied without ever generating a referral row),
                // check for a referral row stuck in some OTHER status (e.g.
                // PENDING, CONVERTED, EXPIRED — anything but COMPLETED/REVERSED).
                // Such a row means a referral exists but was never completed, so
                // the COMPLETED-filtered reversal above silently skipped it and a
                // bonus could be left dangling/unreversed.  Surface it loudly so
                // operators can investigate and reverse manually — but do NOT
                // auto-reverse it here.
                const [unexpectedStatus] = await tx
                  .select({ id: referralsTable.id, status: referralsTable.status })
                  .from(referralsTable)
                  .where(and(
                    eq(referralsTable.tenantId, me.tenantId),
                    eq(referralsTable.code, existing.discountReferralCode),
                    notInArray(referralsTable.status, [REFERRAL_STATUS.COMPLETED, REFERRAL_STATUS.REVERSED]),
                  ))
                  .limit(1);

                if (unexpectedStatus) {
                  req.log.warn(
                    {
                      tenantId: me.tenantId,
                      referralId: unexpectedStatus.id,
                      referralStatus: unexpectedStatus.status,
                      referralCode: existing.discountReferralCode,
                      reservationId: req.params.id,
                      reason: "unexpected_status",
                    },
                    "Referral reversal skipped: referral row found in an unexpected status (not COMPLETED/REVERSED) — bonus may be left unreversed; investigate and reverse manually",
                  );
                }
                // else: no referral record in ANY status — legitimate legacy
                // case (code may have been applied without generating a referral
                // row, or the row was never created; no bonus to reverse).
                // Silently skip.
              }
            }
          }

          if (referralRecord) {
            const bonusToReverse = Number(referralRecord.bonusAmount);
            await tx.execute(
              sql`SELECT id FROM clients WHERE id = ${referralRecord.referrerId} AND tenant_id = ${me.tenantId} FOR UPDATE`
            );
            await tx.update(clientsTable)
              .set({
                successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
                referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
              })
              .where(and(
                eq(clientsTable.id, referralRecord.referrerId),
                eq(clientsTable.tenantId, me.tenantId),
              ));
            const reversalNow = new Date();
            await tx.update(referralsTable)
              .set({ status: REFERRAL_STATUS.REVERSED, reversalReason: "reservation_cancelled", reversalAt: reversalNow, updatedAt: reversalNow })
              .where(eq(referralsTable.id, referralRecord.id));
            // Mark the reversal as completed so re-cancel flows are short-circuited
            // by the explicit idempotency guard above (mirrors couponReversalAt).
            updates.referralReversalAt = new Date();
            // Capture for post-transaction notification (#28)
            reversedReferralInfo = { referrerId: referralRecord.referrerId, referredId: referralRecord.referredId, bonusAmount: referralRecord.bonusAmount };
          }
        }

        // --- Reversal 4: loyalty points earned from this reservation ---
        // Points can be earned either when payments are received (referenceType="payment")
        // or when the reservation is confirmed (referenceType="reservation"). We must
        // clawback both kinds, so we always look up the loyalty member when a clientId
        // exists — not just when payments exist.
        if (existing.clientId) {
          // Acquire a row-level lock on the loyalty member BEFORE the idempotency
          // check.  Without this lock, two concurrent cancellation requests can both
          // pass the idempotency SELECT (seeing no existing "cancellation" transaction)
          // before either one commits its INSERT, resulting in two clawback transactions
          // and a double-deduction of points.  The FOR UPDATE lock serializes concurrent
          // transactions: the second request blocks here until the first commits, then
          // re-checks the idempotency condition and correctly finds the existing record.
          await tx.execute(
            sql`SELECT id FROM loyalty_members WHERE tenant_id = ${me.tenantId} AND client_id = ${existing.clientId} LIMIT 1 FOR UPDATE`
          );
          const reservationPayments = await tx
            .select({ id: paymentsTable.id })
            .from(paymentsTable)
            .where(and(
              eq(paymentsTable.tenantId, me.tenantId),
              eq(paymentsTable.reservationId, req.params.id),
            ));
          const [loyaltyMember] = await tx
            .select({
              id: loyaltyMembersTable.id,
              availablePoints: loyaltyMembersTable.availablePoints,
              totalPoints: loyaltyMembersTable.totalPoints,
            })
            .from(loyaltyMembersTable)
            .where(and(
              eq(loyaltyMembersTable.tenantId, me.tenantId),
              eq(loyaltyMembersTable.clientId, existing.clientId),
            ))
            .limit(1);
          if (loyaltyMember) {
            // Idempotency: skip if a "cancellation" transaction for this reservation already exists
            // (prevents double-clawback on reopen → re-cancel flows)
            const [existingClawback] = await tx
              .select({ id: loyaltyTransactionsTable.id })
              .from(loyaltyTransactionsTable)
              .where(and(
                eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
                eq(loyaltyTransactionsTable.type, "cancellation"),
                eq(loyaltyTransactionsTable.referenceId, req.params.id),
              ))
              .limit(1);
            if (!existingClawback) {
              const paymentIds = reservationPayments.map(p => p.id);
              // Query earn transactions tied to this reservation directly (confirmation-earned)
              // and, when payments exist, also those tied to individual payments.
              const earnTransactions = await tx
                .select({ points: loyaltyTransactionsTable.points })
                .from(loyaltyTransactionsTable)
                .where(and(
                  eq(loyaltyTransactionsTable.tenantId, me.tenantId),
                  eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
                  eq(loyaltyTransactionsTable.type, "earn"),
                  paymentIds.length > 0
                    ? or(
                        inArray(loyaltyTransactionsTable.referenceId, paymentIds),
                        eq(loyaltyTransactionsTable.referenceId, req.params.id),
                      )
                    : eq(loyaltyTransactionsTable.referenceId, req.params.id),
                ));
              const totalEarnedPoints = earnTransactions.reduce((sum, t) => sum + t.points, 0);
              if (totalEarnedPoints > 0) {
                const newAvailable = Math.max(0, loyaltyMember.availablePoints - totalEarnedPoints);
                const newTotal = Math.max(0, loyaltyMember.totalPoints - totalEarnedPoints);
                await tx.update(loyaltyMembersTable)
                  .set({
                    availablePoints: newAvailable,
                    totalPoints: newTotal,
                    tier: calculateTier(newTotal),
                    lastActivityAt: new Date(),
                  })
                  .where(eq(loyaltyMembersTable.id, loyaltyMember.id));
                await tx.insert(loyaltyTransactionsTable).values({
                  id: generateId(),
                  tenantId: me.tenantId,
                  memberId: loyaltyMember.id,
                  type: "cancellation",
                  points: -totalEarnedPoints,
                  description: `Estorno de pontos — cancelamento da reserva ${existing.voucherCode}`,
                  referenceId: req.params.id,
                  referenceType: "reservation",
                });
              }
            }
          }
        }

        // --- Cancel orphan commissions (pending/approved) tied to this reservation ---
        await tx.update(commissionsTable)
          .set({ status: COMMISSION_STATUS.CANCELLED })
          .where(and(
            eq(commissionsTable.reservationId, req.params.id),
            eq(commissionsTable.tenantId, me.tenantId),
            inArray(commissionsTable.status, [COMMISSION_STATUS.PENDING, COMMISSION_STATUS.APPROVED]),
          ));

        // --- Cancel linked store order ---
        // Reservations created via the storefront carry a storeOrderId (= orderNumber
        // of the originating store order). When the reservation is cancelled we must
        // also close out that order so it does not remain in a dangling open state.
        // We skip orders that are already cancelled or completed to stay idempotent.
        if (existing.storeOrderId) {
          const [storeOrder] = await tx
            .select({ id: storeOrdersTable.id, status: storeOrdersTable.status })
            .from(storeOrdersTable)
            .where(and(
              eq(storeOrdersTable.tenantId, me.tenantId),
              eq(storeOrdersTable.orderNumber, existing.storeOrderId),
            ))
            .limit(1);
          if (
            storeOrder &&
            storeOrder.status !== STORE_ORDER_STATUS.CANCELLED &&
            storeOrder.status !== STORE_ORDER_STATUS.COMPLETED
          ) {
            await tx.update(storeOrdersTable)
              .set({ status: STORE_ORDER_STATUS.CANCELLED, cancelledAt: new Date() })
              .where(eq(storeOrdersTable.id, storeOrder.id));
          }
        }
      }

      // --- Seat counter sync for manual status transitions ---
      // pending → confirmed: move seats from reserved to confirmed bucket
      if (isBeingConfirmed && existing.seats.length > 0) {
        const seatsCount = existing.seats.length;
        await tx.update(tripsTable).set({
          confirmedSeats: sql`confirmed_seats + ${seatsCount}`,
          reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})`,
        }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
      }

      // confirmed → pending: revert seats from confirmed back to reserved bucket
      if (isBeingDemoted && existing.seats.length > 0) {
        const seatsCount = existing.seats.length;
        await tx.update(tripsTable).set({
          confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})`,
          reservedSeats: sql`reserved_seats + ${seatsCount}`,
        }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
      }

      await tx.update(reservationsTable).set(updates)
        .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)));
      const [updated] = await tx.select().from(reservationsTable)
        .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!updated) return null;

      if (parsed.data.seats != null) {
        const newSeats = parsed.data.seats;
        const newCount = newSeats.length;
        const priorSeats: string[] = existing.seats ?? [];

        // --- Seat counter delta for seat array SIZE changes ---
        // The status-transition blocks above (isBeingConfirmed / isBeingDemoted) already
        // moved the OLD seat count between buckets. Here we compensate for any CHANGE in
        // the NUMBER of seats so the counters remain accurate even when only the seats
        // array changes (e.g. adding a seat to an existing confirmed reservation).
        // Skip when being cancelled — that path restores all seats in its own block.
        if (!isBeingCancelled && existing.tripId) {
          const seatDelta = newCount - priorSeats.length;
          if (seatDelta !== 0) {
            const finalStatus = isBeingConfirmed
              ? RESERVATION_STATUS.CONFIRMED
              : isBeingDemoted
                ? RESERVATION_STATUS.PENDING
                : existing.status;
            if (finalStatus === RESERVATION_STATUS.CONFIRMED) {
              await tx.update(tripsTable).set({
                confirmedSeats: sql`GREATEST(0, confirmed_seats + ${seatDelta})`,
                availableSeats: sql`GREATEST(0, LEAST(total_capacity, available_seats - ${seatDelta}))`,
              }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
            } else if (finalStatus === RESERVATION_STATUS.PENDING) {
              await tx.update(tripsTable).set({
                reservedSeats: sql`GREATEST(0, reserved_seats + ${seatDelta})`,
                availableSeats: sql`GREATEST(0, LEAST(total_capacity, available_seats - ${seatDelta}))`,
              }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
            }
          }
        }

        // Order passengers by their position in the prior seats array (primary always first).
        const currentPassengers = await tx.select()
          .from(passengersTable)
          .where(eq(passengersTable.reservationId, req.params.id))
          .orderBy(desc(passengersTable.isPrimary), asc(passengersTable.id));

        // Re-sort in JS to use prior seats index for stable positional mapping.
        currentPassengers.sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          const ai = priorSeats.indexOf(a.seatNumber ?? "");
          const bi = priorSeats.indexOf(b.seatNumber ?? "");
          return (ai === -1 ? priorSeats.length : ai) - (bi === -1 ? priorSeats.length : bi);
        });

        const currentCount = currentPassengers.length;

        if (newCount === 0) {
          // seats cleared: delete all passenger rows to keep count aligned with seats.length.
          if (currentCount > 0) {
            const filledOnClear = currentPassengers.filter(p =>
              (p.name && p.name !== "A preencher") || p.cpf
            );
            if (filledOnClear.length > 0) {
              throw new AppError(
                "Cannot reduce seats: some passengers being removed already have their details filled in. Please clear or reassign them first.",
                409,
                "PASSENGERS_FILLED",
                { affectedPassengers: filledOnClear.map(p => ({ id: p.id, name: p.name, cpf: p.cpf })) },
              );
            }
            await tx.delete(passengersTable)
              .where(eq(passengersTable.reservationId, req.params.id));
          }
        } else if (currentCount === 0) {
          // No passengers exist yet — bootstrap primary from client data then add placeholders.
          if (existing.clientId) {
            const [clientData] = await tx.select().from(clientsTable)
              .where(and(eq(clientsTable.id, existing.clientId), eq(clientsTable.tenantId, me.tenantId)))
              .limit(1);
            if (clientData) {
              await tx.insert(passengersTable).values({
                id: generateId(),
                reservationId: req.params.id,
                name: clientData.name,
                cpf: clientData.cpf ?? null,
                rg: clientData.rg ?? null,
                birthDate: clientData.birthDate ?? null,
                ageCategory: deriveAgeCategory(clientData.birthDate ?? null),
                seatNumber: newSeats[0] ?? null,
                isChildUnder7: getAgeYears(clientData.birthDate ?? null) < 7,
                isPrimary: true,
              }).onConflictDoNothing();
            }
          }
          for (let i = 1; i < newCount; i++) {
            await tx.insert(passengersTable).values({
              id: generateId(),
              reservationId: req.params.id,
              name: "A preencher",
              cpf: null,
              rg: null,
              birthDate: null,
              ageCategory: "adult",
              seatNumber: newSeats[i] ?? null,
              isChildUnder7: false,
              isPrimary: false,
            });
          }
        } else if (newCount >= currentCount) {
          // Same count or more: add placeholders for extra seats, remap existing ones.
          for (let i = currentCount; i < newCount; i++) {
            await tx.insert(passengersTable).values({
              id: generateId(),
              reservationId: req.params.id,
              name: "A preencher",
              cpf: null,
              rg: null,
              birthDate: null,
              ageCategory: "adult",
              seatNumber: newSeats[i] ?? null,
              isChildUnder7: false,
              isPrimary: false,
            });
          }
          for (let i = 0; i < currentCount; i++) {
            const p = currentPassengers[i];
            const newSeat = newSeats[i] ?? null;
            const seatFields: Partial<typeof passengersTable.$inferInsert> = { seatNumber: newSeat };
            // Recalculate child/baby category when seat changes for isChildUnder7 passengers
            if (p.isChildUnder7) {
              seatFields.ageCategory = resolveChildAgeCategory(newSeat);
            }
            await tx.update(passengersTable).set(seatFields)
              .where(eq(passengersTable.id, p.id));
          }
        } else {
          // Fewer seats: choose removal candidates globally.
          // Priority: blank non-primary first (no cpf / placeholder name), then non-primary
          // with data; primary is always the last to be removed.
          const primaryPassenger = currentPassengers.find(p => p.isPrimary);
          const nonPrimary = currentPassengers.filter(p => !p.isPrimary);

          const sortedNonPrimary = [...nonPrimary].sort((a, b) => {
            const aBlank = (!a.cpf && (!a.name || a.name === "A preencher")) ? 0 : 1;
            const bBlank = (!b.cpf && (!b.name || b.name === "A preencher")) ? 0 : 1;
            return aBlank - bBlank;
          });

          const keepNonPrimaryCount = primaryPassenger ? newCount - 1 : newCount;
          const keepNonPrimary = sortedNonPrimary.slice(sortedNonPrimary.length - Math.max(0, keepNonPrimaryCount));
          const removeNonPrimary = sortedNonPrimary.slice(0, sortedNonPrimary.length - Math.max(0, keepNonPrimaryCount));
          const passengersToKeep = primaryPassenger ? [primaryPassenger, ...keepNonPrimary] : keepNonPrimary;

          const filledPassengers = removeNonPrimary.filter(p =>
            (p.name && p.name !== "A preencher") || p.cpf
          );
          if (filledPassengers.length > 0) {
            throw new AppError(
              "Cannot reduce seats: some passengers being removed already have their details filled in. Please clear or reassign them first.",
              409,
              "PASSENGERS_FILLED",
              { affectedPassengers: filledPassengers.map(p => ({ id: p.id, name: p.name, cpf: p.cpf })) },
            );
          }

          if (removeNonPrimary.length > 0) {
            await tx.delete(passengersTable)
              .where(inArray(passengersTable.id, removeNonPrimary.map(p => p.id)));
          }

          const orderedKept = [
            ...passengersToKeep.filter(p => p.isPrimary),
            ...passengersToKeep.filter(p => !p.isPrimary),
          ];
          for (let i = 0; i < orderedKept.length; i++) {
            const p = orderedKept[i];
            const newSeat = newSeats[i] ?? null;
            const seatFields: Partial<typeof passengersTable.$inferInsert> = { seatNumber: newSeat };
            // Recalculate child/baby category when seat changes for isChildUnder7 passengers
            if (p.isChildUnder7) {
              seatFields.ageCategory = resolveChildAgeCategory(newSeat);
            }
            await tx.update(passengersTable).set(seatFields)
              .where(eq(passengersTable.id, p.id));
          }
        }
      }

      return updated;
    });

    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    if (parsed.data.totalValue != null && existing.clientId) {
      syncClientDeal(existing.clientId, me.tenantId, existing.tripId, parsed.data.totalValue, me.id, req.params.id)
        .catch((err) => req.log.error({ err }, "Error syncing deal after reservation update"));
    }
    if (isBeingConfirmed && existing.clientId) {
      loyaltyAwardPointsForReservation({
        clientId: existing.clientId,
        reservationId: req.params.id,
        amount: reservation.totalValue,
        tenantId: me.tenantId,
      }).catch((err) => req.log.error({ err }, "Error awarding loyalty points on reservation confirmation"));
    }
    if (isBeingCancelled && existing.clientId) {
      const code = existing.voucherCode ?? req.params.id.slice(-8).toUpperCase();
      writeClientActivity(existing.clientId, "reservation_cancelled", `Reserva ${code} cancelada`, me.id, { voucherCode: code })
        .catch((err) => req.log.error({ err }, "Error writing cancellation activity"));
      cancelDealOnReservationCancellation({ tenantId: me.tenantId, reservationId: existing.id })
        .catch((err) => req.log.error({ err }, "Error cancelling deal on reservation cancellation"));
    }
    if (!isBeingCancelled) {
      enqueueCommissionSync(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueuing commission sync after reservation update"));
    }
    const formatted = await formatReservation(reservation);
    res.json(formatted);
    if (parsed.data.firstDueDate) {
      const instCount = parsed.data.installments ?? reservation.installments ?? 1;
      const total = parsed.data.totalValue != null ? parsed.data.totalValue : Number(reservation.totalValue);
      generateInstallments(req.params.id, me.tenantId, total, instCount, parsed.data.firstDueDate)
        .catch((err) => req.log.error({ err }, "Error regenerating installments on reservation update"));
    }
    // Send cancellation email only on a true active → cancelled transition
    // (not for "refunded", not for repeated patches on already-cancelled reservations)
    if (parsed.data.status === RESERVATION_STATUS.CANCELLED && wasActive && existing.clientId) {
      enqueueReservationCancellationEmail(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing cancellation email"));
      const loyaltyPointsRefunded = (existing.discountLoyaltyPoints ?? 0) > 0
        ? (existing.discountLoyaltyPoints ?? 0)
        : undefined;
      insertClientNotification(
        existing.clientId,
        me.tenantId,
        "reservation_cancelled",
        {
          voucherCode: existing.voucherCode ?? undefined,
          ...(loyaltyPointsRefunded != null && { loyaltyPointsRefunded }),
        },
      ).catch((err) => req.log.error({ err }, "Error inserting cancellation client notification"));
    }
    // When a fully-paid reservation is confirmed via status change, notify the agency
    if (isBeingConfirmed) {
      enqueueNewBookingNotificationEmail(req.params.id, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing agency new-booking notification on reservation confirmation"));
    }
    // #18: When a reservation is confirmed, push a notification to the client's mobile app
    if (isBeingConfirmed && existing.clientId) {
      (async () => {
        try {
          const [client] = await db.select({
            expoPushToken: clientsTable.expoPushToken,
            whatsapp: clientsTable.whatsapp,
            phone: clientsTable.phone,
            name: clientsTable.name,
            whatsappOptIn: clientsTable.whatsappOptIn,
          })
            .from(clientsTable)
            .where(and(eq(clientsTable.id, existing.clientId!), eq(clientsTable.tenantId, me.tenantId)))
            .limit(1);
          if (client?.expoPushToken) {
            await sendPushNotification({
              to: client.expoPushToken,
              title: "Reserva confirmada",
              body: `Sua reserva ${existing.voucherCode ?? ""} foi confirmada. Boa viagem!`.trim(),
              data: { type: "reservation_confirmed", reservationId: existing.id },
            });
          }
          // WhatsApp confirmation when status changes to confirmed via PATCH
          dispatchWhatsAppReservationConfirmed({
            reservationId: existing.id,
            tenantId: me.tenantId,
          }).catch((err) => req.log.warn({ err }, "[whatsapp] Reservation confirmed (PATCH) dispatch failed — non-fatal"));
        } catch (err) {
          req.log.error({ err }, "Error sending push notification on reservation confirmation");
        }
      })();
    }
    // #28: When a referral is reversed on cancellation, notify the referrer
    if (reversedReferralInfo) {
      const { referrerId: _rrReferrerId, referredId: _rrReferredId, bonusAmount: _rrBonusAmount } = reversedReferralInfo;
      dispatchReferralReversedEmail({ referrerId: _rrReferrerId, referredId: _rrReferredId, bonusAmount: _rrBonusAmount, tenantId: me.tenantId, reason: "reservation_cancelled" })
        .catch((err) => req.log.error({ err }, "Error enqueueing referral reversal notification email"));
    }
    broadcastSeatUpdate(existing.tripId, me.tenantId).catch(() => {});
    // Sync Google Calendar events after every reservation PATCH.
    // Use the dedicated cancellation path for active→cancelled/refunded transitions
    // (ensures stale seller events and reduced passenger count are reflected explicitly);
    // fall back to the general syncTrip for all other updates (sellerId, totalValue, etc.)
    if (isBeingCancelled && wasActive) {
      CalendarSyncService.syncTripOnReservationCancellation(existing.tripId)
        .catch((err) => req.log.error({ err }, "Error syncing Google Calendar after reservation cancellation"));
    } else {
      CalendarSyncService.syncTrip(existing.tripId)
        .catch((err) => req.log.error({ err }, "Error syncing Google Calendar after reservation update"));
    }
  } catch (err) {
    next(err);
  }
});

const UpdateInstallmentBodySchema = z.object({
  paidAmount: z.number().positive().nullish(),
  paidAt: z.string().nullish(),
  dueDate: z.string().nullish(),
  notes: z.string().nullish(),
});

router.get("/reservations/:id/installments", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await requireReservationAccess(me, req.params.id);
    const rows = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.reservationId, req.params.id))
      .orderBy(asc(reservationInstallmentsTable.installmentNumber));
    const now = new Date();
    const formatted = rows.map(r => ({
      id: r.id,
      reservationId: r.reservationId,
      installmentNumber: r.installmentNumber,
      dueDate: (r.dueDate as unknown as Date).toISOString(),
      amount: Number(r.amount),
      paidAmount: r.paidAmount != null ? Number(r.paidAmount) : null,
      paidAt: r.paidAt ? (r.paidAt as unknown as Date).toISOString() : null,
      notes: r.notes ?? null,
      status: r.paidAt != null ? "paid" : (r.dueDate as unknown as Date) < now ? "overdue" : "pending",
    }));
    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/installments/upcoming", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === "cliente") { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "7")), 1), 90);
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + days);
    until.setHours(23, 59, 59, 999);

    const rows = await db
      .select({
        id: reservationInstallmentsTable.id,
        reservationId: reservationInstallmentsTable.reservationId,
        installmentNumber: reservationInstallmentsTable.installmentNumber,
        dueDate: reservationInstallmentsTable.dueDate,
        amount: reservationInstallmentsTable.amount,
        paidAt: reservationInstallmentsTable.paidAt,
        notes: reservationInstallmentsTable.notes,
        voucherCode: reservationsTable.voucherCode,
        clientId: reservationsTable.clientId,
        clientName: clientsTable.name,
        tripName: tripsTable.name,
      })
      .from(reservationInstallmentsTable)
      .innerJoin(reservationsTable, eq(reservationInstallmentsTable.reservationId, reservationsTable.id))
      .leftJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
      .leftJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .where(and(
        eq(reservationInstallmentsTable.tenantId, me.tenantId),
        sql`${reservationInstallmentsTable.paidAt} IS NULL`,
        sql`${reservationInstallmentsTable.dueDate} >= NOW()`,
        sql`${reservationInstallmentsTable.dueDate} <= ${until.toISOString()}`,
      ))
      .orderBy(asc(reservationInstallmentsTable.dueDate));

    res.json(rows.map(r => ({
      id: r.id,
      reservationId: r.reservationId,
      installmentNumber: r.installmentNumber,
      dueDate: (r.dueDate as unknown as Date).toISOString(),
      amount: Number(r.amount),
      paidAt: r.paidAt ? (r.paidAt as unknown as Date).toISOString() : null,
      notes: r.notes ?? null,
      status: "pending",
      voucherCode: r.voucherCode ?? null,
      clientName: r.clientName ?? null,
      tripName: r.tripName ?? null,
    })));
  } catch (err) {
    next(err);
  }
});

router.patch("/reservations/installments/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = UpdateInstallmentBodySchema.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [installment] = await db.select().from(reservationInstallmentsTable)
      .where(and(eq(reservationInstallmentsTable.id, req.params.id), eq(reservationInstallmentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!installment) { next(new NotFoundError("Installment not found", "NOT_FOUND")); return; }

    // Ensure the caller has access to the parent reservation
    await requireReservationAccess(me, installment.reservationId);

    const updates: Partial<typeof reservationInstallmentsTable.$inferInsert> = {};
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    if (parsed.data.dueDate !== undefined && parsed.data.dueDate) {
      const d = new Date(`${parsed.data.dueDate}T12:00:00Z`);
      if (!isNaN(d.getTime())) updates.dueDate = d;
    }
    if (parsed.data.paidAmount !== undefined) {
      updates.paidAmount = parsed.data.paidAmount != null ? String(parsed.data.paidAmount) : null;
    }
    if (parsed.data.paidAt !== undefined) {
      updates.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;
    }
    if (parsed.data.paidAmount != null && !parsed.data.paidAt && !installment.paidAt) {
      updates.paidAt = new Date();
    }

    await db.update(reservationInstallmentsTable)
      .set(updates)
      .where(eq(reservationInstallmentsTable.id, req.params.id));

    const allInstallments = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.reservationId, installment.reservationId));
    const totalPaid = allInstallments.reduce((sum, r) => {
      const pa = r.id === req.params.id ? (parsed.data.paidAmount ?? (updates.paidAt ? Number(r.amount) : null)) : (r.paidAt ? Number(r.paidAmount ?? r.amount) : null);
      return sum + (pa ?? 0);
    }, 0);

    const [reservation] = await db.select({ totalValue: reservationsTable.totalValue })
      .from(reservationsTable).where(eq(reservationsTable.id, installment.reservationId)).limit(1);
    if (reservation) {
      const total = Number(reservation.totalValue);
      const newBalance = Math.max(0, total - totalPaid);
      await db.update(reservationsTable)
        .set({ paidValue: totalPaid.toFixed(2), balance: newBalance.toFixed(2) })
        .where(eq(reservationsTable.id, installment.reservationId));
    }

    const [updated] = await db.select().from(reservationInstallmentsTable)
      .where(eq(reservationInstallmentsTable.id, req.params.id)).limit(1);
    const now = new Date();
    res.json({
      id: updated.id,
      reservationId: updated.reservationId,
      installmentNumber: updated.installmentNumber,
      dueDate: (updated.dueDate as unknown as Date).toISOString(),
      amount: Number(updated.amount),
      paidAmount: updated.paidAmount != null ? Number(updated.paidAmount) : null,
      paidAt: updated.paidAt ? (updated.paidAt as unknown as Date).toISOString() : null,
      notes: updated.notes ?? null,
      status: updated.paidAt != null ? "paid" : (updated.dueDate as unknown as Date) < now ? "overdue" : "pending",
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await requireReservationAccess(me, req.params.id);

    await db.transaction(async (tx) => {
      if (!CANCELLING_STATUSES.includes(existing.status)) {
        const seatsCount = existing.seats.length;
        if (seatsCount > 0) {
          const wasConfirmedOnDelete = existing.status === RESERVATION_STATUS.CONFIRMED;
          await tx.update(tripsTable).set({
            availableSeats: sql`LEAST(total_capacity, GREATEST(0, available_seats + ${seatsCount}))`,
            ...(wasConfirmedOnDelete
              ? { confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})` }
              : { reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})` }),
          }).where(and(eq(tripsTable.id, existing.tripId), eq(tripsTable.tenantId, me.tenantId)));
        }
      }
      await tx.delete(reservationsTable)
        .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)));
    });
    res.json({ success: true });
    broadcastSeatUpdate(existing.tripId, me.tenantId).catch(() => {});
    CalendarSyncService.syncTrip(existing.tripId)
      .catch((err) => req.log.warn({ err, context: "reservation.delete", tripId: existing.tripId, reservationId: req.params.id }, "Calendar sync falhou — continuando"));
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await requireReservationAccess(me, req.params.id);
    await db.update(reservationsTable).set({
      checkedInAt: new Date(),
      status: RESERVATION_STATUS.COMPLETED,
    }).where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)));
    const [reservation] = await db.select().from(reservationsTable)
      .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    const formatted = await formatReservation(reservation);
    res.json(formatted);
    if (existing.clientId) {
      const [trip] = await db.select({ name: tripsTable.name }).from(tripsTable)
        .where(eq(tripsTable.id, existing.tripId)).limit(1);
      const tripName = trip?.name ?? "viagem";
      writeClientActivity(existing.clientId, "checkin", `Check-in realizado na viagem ${tripName}`, me.id, { tripName })
        .catch((err) => req.log.error({ err }, "Error writing check-in activity"));
      moveDealToStage({ tenantId: me.tenantId, clientId: existing.clientId, reservationId: req.params.id, targetStageName: "Em Viagem", forwardOnly: true })
        .catch((err) => req.log.error({ err }, "Error moving deal to Em Viagem on check-in"));
    }
  } catch (err) {
    next(err);
  }
});

router.get("/reservations/:reservationId/passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const passengers = await db.select().from(passengersTable)
      .where(eq(passengersTable.reservationId, req.params.reservationId));
    res.json(passengers.map(formatPassenger));
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:reservationId/passengers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const parsed = CreatePassengerBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    // Compute ageCategory from the isChildUnder7 hint, then derive isChildUnder7
    // atomically so both fields are always consistent in the DB.
    const resolvedAgeCategory: string = parsed.data.isChildUnder7 === true
      ? resolveChildAgeCategory(parsed.data.seatNumber ?? null)
      : parsed.data.ageCategory;
    const resolvedIsChildUnder7 = syncIsChildUnder7(resolvedAgeCategory);

    const id = generateId();
    await db.insert(passengersTable).values({
      id,
      reservationId: req.params.reservationId,
      name: parsed.data.name,
      cpf: parsed.data.cpf ?? null,
      rg: parsed.data.rg ?? null,
      birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
      ageCategory: resolvedAgeCategory,
      seatNumber: parsed.data.seatNumber ?? null,
      isChildUnder7: resolvedIsChildUnder7,
    });
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new AppError("Failed to create passenger", 500, "PASSENGER_CREATE_FAILED")); return; }
    res.status(201).json(formatPassenger(passenger));
  } catch (err) {
    next(err);
  }
});

router.patch("/reservations/:reservationId/passengers/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    const parsed = UpdatePassengerBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const updates: Partial<typeof passengersTable.$inferInsert> = {};
    if (parsed.data.name != null) updates.name = parsed.data.name;
    if (parsed.data.cpf !== undefined) updates.cpf = parsed.data.cpf ?? null;
    if (parsed.data.rg !== undefined) updates.rg = parsed.data.rg ?? null;
    if (parsed.data.birthDate !== undefined) updates.birthDate = parsed.data.birthDate ? new Date(parsed.data.birthDate) : null;
    if (parsed.data.seatNumber !== undefined) updates.seatNumber = parsed.data.seatNumber ?? null;

    // Always update both ageCategory and isChildUnder7 atomically so they are
    // never contradictory in the DB.
    //
    // Priority order when both or either are sent:
    //  1. isChildUnder7 flag present → derive ageCategory from seat (flag wins)
    //  2. ageCategory present (no flag) → set ageCategory, derive isChildUnder7 from it
    //
    if (parsed.data.isChildUnder7 !== undefined) {
      if (parsed.data.isChildUnder7) {
        // Determine effective seat: use incoming value if provided, else read from DB
        let effectiveSeat: string | null;
        if (parsed.data.seatNumber !== undefined) {
          effectiveSeat = parsed.data.seatNumber ?? null;
        } else {
          const [existing] = await db.select({ seatNumber: passengersTable.seatNumber })
            .from(passengersTable)
            .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
            .limit(1);
          effectiveSeat = existing?.seatNumber ?? null;
        }
        // seated child → Criança; on-lap child → Bebê
        const resolvedCat = resolveChildAgeCategory(effectiveSeat);
        updates.ageCategory = resolvedCat;
        updates.isChildUnder7 = true; // always true when flag is true
      } else {
        // Flag cleared — derive ageCategory from caller-supplied value or default to adult
        const clearedStr = (parsed.data.ageCategory ?? "adult") as string;
        updates.ageCategory = clearedStr as typeof passengersTable.$inferInsert["ageCategory"];
        updates.isChildUnder7 = syncIsChildUnder7(clearedStr); // false unless caller sends child/baby
      }
    } else if (parsed.data.ageCategory != null) {
      // No flag sent — update ageCategory and derive isChildUnder7 from it atomically
      const catOnly = parsed.data.ageCategory as string;
      updates.ageCategory = catOnly;
      updates.isChildUnder7 = syncIsChildUnder7(catOnly);
    }

    const seatNumberChanged = parsed.data.seatNumber !== undefined;
    await db.update(passengersTable).set(updates)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
    // Broadcast seat-map SSE event when a passenger's seat number changes so
    // the boarding panel (PassengersList / Lista ANTT) auto-refreshes without
    // requiring a manual page reload.
    if (seatNumberChanged) {
      broadcastSeatUpdate(reservation.tripId, me.tenantId).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:reservationId/passengers/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.RESERVATIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.delete(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:reservationId/passengers/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.update(passengersTable)
      .set({ checkedInAt: new Date() })
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
  } catch (err) {
    next(err);
  }
});

router.delete("/reservations/:reservationId/passengers/:id/check-in", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const reservation = await requireReservationAccess(me, req.params.reservationId);
    await db.update(passengersTable)
      .set({ checkedInAt: null })
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)));
    const [passenger] = await db.select().from(passengersTable)
      .where(and(eq(passengersTable.id, req.params.id), eq(passengersTable.reservationId, req.params.reservationId)))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }
    res.json(formatPassenger(passenger));
  } catch (err) {
    next(err);
  }
});

router.post("/reservations/:id/retry-commission-sync", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [reservation] = await db.select()
      .from(reservationsTable)
      .where(and(eq(reservationsTable.id, req.params.id), eq(reservationsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!reservation) { next(new NotFoundError("Reservation not found", "NOT_FOUND")); return; }

    await enqueueCommissionSync(reservation.id, me.tenantId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
