import { Router, type NextFunction } from "express";
import {
  db,
  accommodationsTable,
  accommodationRoomsTable,
  accommodationRoomBedsTable,
  accommodationRatesTable,
  accommodationRateHistoryTable,
  accommodationRoomInventoryTable,
  accommodationRoomBlocksTable,
  tripAccommodationsTable,
  accommodationStaysTable,
  accommodationStayGuestsTable,
  accommodationStayRateLinesTable,
  accommodationRoomAssignmentsTable,
  reservationRoomAssignmentsTable,
  reservationsTable,
  tripsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/tenant";
import { ADMIN_ROLES } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";
import { ACTIVE_RESERVATION_STATUSES } from "@workspace/permissions";

const router = Router();

const ACTIVE_STAY_STATUSES = ["held", "confirmed", "checked_in", "in_house"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
type AccommodationExecutor = Pick<typeof db, "select" | "insert" | "update">;

function assertDateRange(checkIn: string, checkOut: string): number {
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
    throw new ValidationError("Use datas no formato AAAA-MM-DD", "INVALID_DATE");
  }
  const start = new Date(`${checkIn}T12:00:00Z`);
  const end = new Date(`${checkOut}T12:00:00Z`);
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (nights < 1) throw new ValidationError("O check-out deve ser posterior ao check-in", "INVALID_STAY_PERIOD");
  return nights;
}

function overlaps(checkIn: string, checkOut: string) {
  return and(lt(accommodationStaysTable.checkIn, checkOut), gt(accommodationStaysTable.checkOut, checkIn));
}

function formatRate(rate: typeof accommodationRatesTable.$inferSelect) {
  return {
    ...rate,
    amount: Number(rate.amount),
  };
}

function formatStay(stay: typeof accommodationStaysTable.$inferSelect) {
  return {
    ...stay,
    contractedTotal: stay.contractedTotal == null ? null : Number(stay.contractedTotal),
    frozenTotal: stay.frozenTotal == null ? null : Number(stay.frozenTotal),
  };
}

function formatRoom(room: typeof accommodationRoomsTable.$inferSelect) {
  return {
    ...room,
    pricePerNight: room.pricePerNight == null ? null : Number(room.pricePerNight),
  };
}

const RateBody = z.object({
  roomId: z.string().optional().nullable(),
  reservationId: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  validFrom: z.string().regex(DATE_RE),
  validTo: z.string().regex(DATE_RE),
  pricingType: z.enum(["PER_ROOM", "PER_PERSON", "PER_BED", "PACKAGE"]),
  amount: z.number().nonnegative(),
  minNights: z.number().int().positive().optional().nullable(),
  maxNights: z.number().int().positive().optional().nullable(),
  minOccupancy: z.number().int().positive().optional().nullable(),
  maxOccupancy: z.number().int().positive().optional().nullable(),
  priority: z.number().int().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  changeReason: z.string().trim().max(500).optional(),
});

const TripAccommodationBody = z.object({
  accommodationId: z.string(),
  checkIn: z.string().regex(DATE_RE),
  checkOut: z.string().regex(DATE_RE),
  status: z.string().optional(),
  isPrimary: z.boolean().optional(),
  pricingPolicy: z.string().optional(),
  contractedPrice: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const StayBody = z.object({
  accommodationId: z.string(),
  tripAccommodationId: z.string().optional().nullable(),
  tripId: z.string().optional().nullable(),
  reservationId: z.string().optional().nullable(),
  storeOrderId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  source: z.enum(["TRIP_RESERVATION", "DIRECT_SALE", "CRM_MANUAL", "STORE_ORDER", "PARTNER"]).default("CRM_MANUAL"),
  checkIn: z.string().regex(DATE_RE),
  checkOut: z.string().regex(DATE_RE),
  status: z.enum(["draft", "held", "confirmed"]).default("draft"),
  pricingType: z.enum(["PER_ROOM", "PER_PERSON", "PER_BED", "PACKAGE"]).optional(),
  notes: z.string().optional().nullable(),
  guests: z.array(z.object({
    name: z.string().trim().min(1),
    document: z.string().optional().nullable(),
    guestType: z.string().optional(),
    passengerId: z.string().optional().nullable(),
  })).min(1),
  assignments: z.array(z.object({
    guestIndex: z.number().int().min(0),
    roomId: z.string(),
    bedId: z.string().optional().nullable(),
  })).optional(),
});

const BlockBody = z.object({
  roomId: z.string().optional().nullable(),
  bedId: z.string().optional().nullable(),
  startDate: z.string().regex(DATE_RE),
  endDate: z.string().regex(DATE_RE),
  blockType: z.string().default("maintenance"),
  reason: z.string().trim().min(1).max(500),
});

const BedBody = z.object({
  name: z.string().trim().min(1).max(80),
  bedType: z.string().trim().min(1).default("single"),
  capacity: z.number().int().min(1).max(4).default(1),
  status: z.string().default("active"),
});

const AssignmentBody = z.object({
  assignments: z.array(z.object({
    guestId: z.string(),
    roomId: z.string(),
    bedId: z.string().optional().nullable(),
  })),
});

async function findAccommodation(tenantId: string, accommodationId: string) {
  const [accommodation] = await db.select().from(accommodationsTable)
    .where(and(eq(accommodationsTable.id, accommodationId), eq(accommodationsTable.tenantId, tenantId)))
    .limit(1);
  if (!accommodation) throw new NotFoundError("Hospedagem não encontrada", "ACCOMMODATION_NOT_FOUND");
  return accommodation;
}

async function chooseRate(
  exec: AccommodationExecutor,
  tenantId: string,
  accommodationId: string,
  room: typeof accommodationRoomsTable.$inferSelect,
  checkIn: string,
  checkOut: string,
  nights: number,
  occupancy: number,
  reservationId?: string | null,
) {
  const rates = await exec.select().from(accommodationRatesTable).where(and(
    eq(accommodationRatesTable.tenantId, tenantId),
    eq(accommodationRatesTable.accommodationId, accommodationId),
    eq(accommodationRatesTable.status, "active"),
    or(isNull(accommodationRatesTable.reservationId), reservationId ? eq(accommodationRatesTable.reservationId, reservationId) : sql`false`),
    lte(accommodationRatesTable.validFrom, checkIn),
    gte(accommodationRatesTable.validTo, checkOut),
    or(isNull(accommodationRatesTable.roomId), eq(accommodationRatesTable.roomId, room.id)),
  ));
  return rates
    .filter(rate =>
      (!rate.category || rate.category === room.category)
      && (rate.minNights == null || nights >= rate.minNights)
      && (rate.maxNights == null || nights <= rate.maxNights)
      && (rate.minOccupancy == null || occupancy >= rate.minOccupancy)
      && (rate.maxOccupancy == null || occupancy <= rate.maxOccupancy),
    )
    .sort((a, b) => {
      const specificityA = (a.reservationId ? 4 : 0) + (a.roomId ? 2 : 0) + (a.category ? 1 : 0);
      const specificityB = (b.reservationId ? 4 : 0) + (b.roomId ? 2 : 0) + (b.category ? 1 : 0);
      return specificityB - specificityA || b.priority - a.priority;
    })[0] ?? null;
}

async function ensureRoomCanReceiveGuests(
  exec: AccommodationExecutor,
  tenantId: string,
  accommodationId: string,
  roomId: string,
  checkIn: string,
  checkOut: string,
  guestCount: number,
  excludedStayId?: string,
) {
  const [room] = await exec.select().from(accommodationRoomsTable).where(and(
    eq(accommodationRoomsTable.id, roomId),
    eq(accommodationRoomsTable.tenantId, tenantId),
    eq(accommodationRoomsTable.accommodationId, accommodationId),
  )).for("update").limit(1);
  if (!room || room.status !== "active" || room.isActive === false) {
    throw new ValidationError("Quarto inválido ou inativo", "ROOM_NOT_AVAILABLE");
  }

  const [blocked] = await exec.select({ id: accommodationRoomBlocksTable.id }).from(accommodationRoomBlocksTable)
    .where(and(
      eq(accommodationRoomBlocksTable.tenantId, tenantId),
      eq(accommodationRoomBlocksTable.accommodationId, accommodationId),
      eq(accommodationRoomBlocksTable.status, "active"),
      lt(accommodationRoomBlocksTable.startDate, checkOut),
      gt(accommodationRoomBlocksTable.endDate, checkIn),
      or(isNull(accommodationRoomBlocksTable.roomId), eq(accommodationRoomBlocksTable.roomId, roomId)),
    )).limit(1);
  if (blocked) throw new ValidationError("Quarto bloqueado no período informado", "ROOM_BLOCKED");

  const [inventoryBlock] = await exec.select({ id: accommodationRoomInventoryTable.id }).from(accommodationRoomInventoryTable)
    .where(and(
      eq(accommodationRoomInventoryTable.tenantId, tenantId),
      eq(accommodationRoomInventoryTable.roomId, roomId),
      ne(accommodationRoomInventoryTable.status, "available"),
      gte(accommodationRoomInventoryTable.inventoryDate, checkIn),
      lt(accommodationRoomInventoryTable.inventoryDate, checkOut),
    )).limit(1);
  if (inventoryBlock) throw new ValidationError("Quarto indisponível em uma das datas", "ROOM_INVENTORY_BLOCKED");

  const activeStays = await exec.select({ id: accommodationStaysTable.id }).from(accommodationStaysTable)
    .where(and(
      eq(accommodationStaysTable.tenantId, tenantId),
      eq(accommodationStaysTable.accommodationId, accommodationId),
      inArray(accommodationStaysTable.status, ACTIVE_STAY_STATUSES),
      overlaps(checkIn, checkOut),
      excludedStayId ? ne(accommodationStaysTable.id, excludedStayId) : sql`true`,
    ));
  const stayIds = activeStays.map(stay => stay.id);
  let used = 0;
  if (stayIds.length > 0) {
    const [row] = await exec.select({ count: sql<number>`count(*)` }).from(accommodationRoomAssignmentsTable)
      .where(and(
        eq(accommodationRoomAssignmentsTable.tenantId, tenantId),
        eq(accommodationRoomAssignmentsTable.roomId, roomId),
        inArray(accommodationRoomAssignmentsTable.stayId, stayIds),
        eq(accommodationRoomAssignmentsTable.status, "active"),
        lt(accommodationRoomAssignmentsTable.checkIn, checkOut),
        gt(accommodationRoomAssignmentsTable.checkOut, checkIn),
        isNull(accommodationRoomAssignmentsTable.unassignedAt),
      ));
    used = Number(row?.count ?? 0);
  }
  const legacyAssignments = await exec.select({ id: reservationRoomAssignmentsTable.id })
    .from(reservationRoomAssignmentsTable)
    .innerJoin(reservationsTable, eq(reservationsTable.id, reservationRoomAssignmentsTable.reservationId))
    .innerJoin(tripsTable, eq(tripsTable.id, reservationRoomAssignmentsTable.tripId))
    .where(and(
      eq(reservationRoomAssignmentsTable.tenantId, tenantId),
      eq(reservationRoomAssignmentsTable.roomId, roomId),
      eq(tripsTable.accommodationId, accommodationId),
      inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      lt(tripsTable.departureDate, new Date(`${checkOut}T12:00:00Z`)),
      gt(tripsTable.returnDate, new Date(`${checkIn}T12:00:00Z`)),
    ));
  used += legacyAssignments.length;
  const inventoryRows = await exec.select({
    inventoryDate: accommodationRoomInventoryTable.inventoryDate,
    status: accommodationRoomInventoryTable.status,
    capacityOverride: accommodationRoomInventoryTable.capacityOverride,
  })
    .from(accommodationRoomInventoryTable)
    .where(and(
      eq(accommodationRoomInventoryTable.tenantId, tenantId),
      eq(accommodationRoomInventoryTable.roomId, roomId),
      gte(accommodationRoomInventoryTable.inventoryDate, checkIn),
      lt(accommodationRoomInventoryTable.inventoryDate, checkOut),
    ));
  const capacity = inventoryRows.reduce(
    (minimum, row) => row.capacityOverride == null ? minimum : Math.min(minimum, row.capacityOverride),
    room.capacity,
  );
  if (used + guestCount > capacity) {
    throw new ValidationError(`O quarto ${room.name} não possui capacidade para todos os hóspedes`, "ROOM_CAPACITY_CONFLICT");
  }
  return room;
}

router.get("/accommodations/:id/rates", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await findAccommodation(me.tenantId, req.params.id);
    const rates = await db.select().from(accommodationRatesTable)
      .where(and(eq(accommodationRatesTable.tenantId, me.tenantId), eq(accommodationRatesTable.accommodationId, req.params.id)))
      .orderBy(desc(accommodationRatesTable.priority), desc(accommodationRatesTable.validFrom));
    res.json(rates.map(formatRate));
  } catch (err) { next(err); }
});

router.get("/accommodations/:id/rate-history", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await findAccommodation(me.tenantId, req.params.id);
    const history = await db.select().from(accommodationRateHistoryTable)
      .innerJoin(accommodationRatesTable, eq(accommodationRatesTable.id, accommodationRateHistoryTable.rateId))
      .where(and(
        eq(accommodationRateHistoryTable.tenantId, me.tenantId),
        eq(accommodationRatesTable.accommodationId, req.params.id),
      ))
      .orderBy(desc(accommodationRateHistoryTable.createdAt));
    res.json(history.map(({ accommodation_rate_history: item, accommodation_rates: rate }) => ({
      ...item,
      rateId: item.rateId,
      rateLabel: rate.reservationId ? `Reserva ${rate.reservationId}` : rate.category ?? "Hospedagem",
      previousValue: item.previousValue == null ? null : Number(item.previousValue),
      newValue: item.newValue == null ? null : Number(item.newValue),
    })));
  } catch (err) { next(err); }
});

router.post("/accommodations/:id/rates", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await findAccommodation(me.tenantId, req.params.id);
    const parsed = RateBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_RATE")); return; }
    const nights = assertDateRange(parsed.data.validFrom, parsed.data.validTo);
    if (parsed.data.roomId) {
      const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
        eq(accommodationRoomsTable.id, parsed.data.roomId),
        eq(accommodationRoomsTable.tenantId, me.tenantId),
        eq(accommodationRoomsTable.accommodationId, req.params.id),
      )).limit(1);
      if (!room) { next(new ValidationError("Quarto não pertence à hospedagem", "ROOM_NOT_FOUND")); return; }
    }
    const id = generateId();
    await db.transaction(async tx => {
      await tx.insert(accommodationRatesTable).values({
        id, tenantId: me.tenantId, accommodationId: req.params.id,
        roomId: parsed.data.roomId ?? null, reservationId: parsed.data.reservationId ?? null, category: parsed.data.category ?? null,
        validFrom: parsed.data.validFrom, validTo: parsed.data.validTo, pricingType: parsed.data.pricingType,
        amount: String(parsed.data.amount), minNights: parsed.data.minNights ?? null, maxNights: parsed.data.maxNights ?? null,
        minOccupancy: parsed.data.minOccupancy ?? null, maxOccupancy: parsed.data.maxOccupancy ?? null,
        priority: parsed.data.priority ?? 0, createdBy: me.id,
      });
      await tx.insert(accommodationRateHistoryTable).values({
        id: generateId(), tenantId: me.tenantId, rateId: id, action: "created",
        newValue: String(parsed.data.amount), newPeriod: `${parsed.data.validFrom}/${parsed.data.validTo}`,
        changedBy: me.id, changeReason: parsed.data.changeReason ?? null,
      });
    });
    const [rate] = await db.select().from(accommodationRatesTable).where(eq(accommodationRatesTable.id, id)).limit(1);
    if (!rate) throw new AppError("Falha ao criar tarifa", 500, "RATE_CREATE_FAILED");
    res.status(201).json({ ...formatRate(rate), nights });
  } catch (err) { next(err); }
});

router.patch("/accommodation-rates/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = RateBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_RATE")); return; }
    const [existing] = await db.select().from(accommodationRatesTable).where(and(
      eq(accommodationRatesTable.id, req.params.id),
      eq(accommodationRatesTable.tenantId, me.tenantId),
    )).limit(1);
    if (!existing) { next(new NotFoundError("Tarifa não encontrada", "RATE_NOT_FOUND")); return; }
    const validFrom = parsed.data.validFrom ?? existing.validFrom;
    const validTo = parsed.data.validTo ?? existing.validTo;
    assertDateRange(validFrom, validTo);
    const nextValue = {
      roomId: parsed.data.roomId === undefined ? existing.roomId : parsed.data.roomId,
      reservationId: parsed.data.reservationId === undefined ? existing.reservationId : parsed.data.reservationId,
      category: parsed.data.category === undefined ? existing.category : parsed.data.category,
      validFrom,
      validTo,
      pricingType: parsed.data.pricingType ?? existing.pricingType,
      amount: parsed.data.amount === undefined ? existing.amount : String(parsed.data.amount),
      minNights: parsed.data.minNights === undefined ? existing.minNights : parsed.data.minNights,
      maxNights: parsed.data.maxNights === undefined ? existing.maxNights : parsed.data.maxNights,
      minOccupancy: parsed.data.minOccupancy === undefined ? existing.minOccupancy : parsed.data.minOccupancy,
      maxOccupancy: parsed.data.maxOccupancy === undefined ? existing.maxOccupancy : parsed.data.maxOccupancy,
      priority: parsed.data.priority ?? existing.priority,
      status: parsed.data.status ?? existing.status,
    };
    await db.transaction(async tx => {
      await tx.update(accommodationRatesTable).set(nextValue).where(eq(accommodationRatesTable.id, existing.id));
      await tx.insert(accommodationRateHistoryTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        rateId: existing.id,
        action: "updated",
        previousValue: existing.amount,
        newValue: String(nextValue.amount),
        previousPeriod: `${existing.validFrom}/${existing.validTo}`,
        newPeriod: `${nextValue.validFrom}/${nextValue.validTo}`,
        changedBy: me.id,
        changeReason: parsed.data.changeReason ?? null,
      });
    });
    const [updated] = await db.select().from(accommodationRatesTable).where(eq(accommodationRatesTable.id, existing.id)).limit(1);
    res.json(formatRate(updated!));
  } catch (err) { next(err); }
});

router.get("/accommodation-rooms/:id/beds", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
      eq(accommodationRoomsTable.id, req.params.id), eq(accommodationRoomsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!room) { next(new NotFoundError("Quarto não encontrado", "ROOM_NOT_FOUND")); return; }
    const beds = await db.select().from(accommodationRoomBedsTable).where(and(
      eq(accommodationRoomBedsTable.roomId, room.id), eq(accommodationRoomBedsTable.tenantId, me.tenantId),
    )).orderBy(asc(accommodationRoomBedsTable.name));
    res.json(beds);
  } catch (err) { next(err); }
});

router.post("/accommodation-rooms/:id/beds", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = BedBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_BED")); return; }
    const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
      eq(accommodationRoomsTable.id, req.params.id), eq(accommodationRoomsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!room) { next(new NotFoundError("Quarto não encontrado", "ROOM_NOT_FOUND")); return; }
    const id = generateId();
    await db.insert(accommodationRoomBedsTable).values({
      id, tenantId: me.tenantId, roomId: room.id, name: parsed.data.name,
      bedType: parsed.data.bedType, capacity: parsed.data.capacity, status: parsed.data.status,
    });
    const [bed] = await db.select().from(accommodationRoomBedsTable).where(eq(accommodationRoomBedsTable.id, id)).limit(1);
    res.status(201).json(bed);
  } catch (err) { next(err); }
});

router.patch("/accommodation-room-beds/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = BedBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_BED")); return; }
    const [bed] = await db.select().from(accommodationRoomBedsTable).where(and(
      eq(accommodationRoomBedsTable.id, req.params.id), eq(accommodationRoomBedsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!bed) { next(new NotFoundError("Cama não encontrada", "BED_NOT_FOUND")); return; }
    await db.update(accommodationRoomBedsTable).set(parsed.data).where(eq(accommodationRoomBedsTable.id, bed.id));
    const [updated] = await db.select().from(accommodationRoomBedsTable).where(eq(accommodationRoomBedsTable.id, bed.id)).limit(1);
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete("/accommodation-room-beds/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [bed] = await db.select().from(accommodationRoomBedsTable).where(and(
      eq(accommodationRoomBedsTable.id, req.params.id), eq(accommodationRoomBedsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!bed) { next(new NotFoundError("Cama não encontrada", "BED_NOT_FOUND")); return; }
    await db.delete(accommodationRoomBedsTable).where(eq(accommodationRoomBedsTable.id, bed.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post("/accommodations/:id/blocks", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await findAccommodation(me.tenantId, req.params.id);
    const parsed = BlockBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_BLOCK")); return; }
    assertDateRange(parsed.data.startDate, parsed.data.endDate);
    if (parsed.data.roomId) {
      const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
        eq(accommodationRoomsTable.id, parsed.data.roomId),
        eq(accommodationRoomsTable.accommodationId, req.params.id),
        eq(accommodationRoomsTable.tenantId, me.tenantId),
      )).limit(1);
      if (!room) { next(new ValidationError("Quarto não pertence à hospedagem", "ROOM_NOT_FOUND")); return; }
    }
    const id = generateId();
    await db.insert(accommodationRoomBlocksTable).values({
      id, tenantId: me.tenantId, accommodationId: req.params.id,
      roomId: parsed.data.roomId ?? null, bedId: parsed.data.bedId ?? null,
      startDate: parsed.data.startDate, endDate: parsed.data.endDate,
      blockType: parsed.data.blockType, reason: parsed.data.reason, createdBy: me.id,
    });
    const [block] = await db.select().from(accommodationRoomBlocksTable).where(eq(accommodationRoomBlocksTable.id, id)).limit(1);
    res.status(201).json(block);
  } catch (err) { next(err); }
});

router.get("/accommodations/:id/blocks", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await findAccommodation(me.tenantId, req.params.id);
    const blocks = await db.select().from(accommodationRoomBlocksTable)
      .where(and(
        eq(accommodationRoomBlocksTable.tenantId, me.tenantId),
        eq(accommodationRoomBlocksTable.accommodationId, req.params.id),
      ))
      .orderBy(desc(accommodationRoomBlocksTable.startDate));
    res.json(blocks);
  } catch (err) { next(err); }
});

router.delete("/accommodation-room-blocks/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [block] = await db.select().from(accommodationRoomBlocksTable).where(and(
      eq(accommodationRoomBlocksTable.id, req.params.id),
      eq(accommodationRoomBlocksTable.tenantId, me.tenantId),
    )).limit(1);
    if (!block) { next(new NotFoundError("Bloqueio não encontrado", "BLOCK_NOT_FOUND")); return; }
    await db.delete(accommodationRoomBlocksTable).where(eq(accommodationRoomBlocksTable.id, block.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

const InventoryBody = z.object({
  inventoryDate: z.string().regex(DATE_RE),
  status: z.enum(["available", "blocked", "maintenance", "closed"]).default("available"),
  capacityOverride: z.number().int().min(0).optional().nullable(),
  blockedReason: z.string().max(500).optional().nullable(),
  maintenanceReason: z.string().max(500).optional().nullable(),
});

router.get("/accommodation-rooms/:id/inventory", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
      eq(accommodationRoomsTable.id, req.params.id),
      eq(accommodationRoomsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!room) { next(new NotFoundError("Quarto não encontrado", "ROOM_NOT_FOUND")); return; }
    const from = String(req.query.from ?? "0001-01-01");
    const to = String(req.query.to ?? "9999-12-31");
    const rows = await db.select().from(accommodationRoomInventoryTable).where(and(
      eq(accommodationRoomInventoryTable.tenantId, me.tenantId),
      eq(accommodationRoomInventoryTable.roomId, room.id),
      gte(accommodationRoomInventoryTable.inventoryDate, from),
      lte(accommodationRoomInventoryTable.inventoryDate, to),
    )).orderBy(asc(accommodationRoomInventoryTable.inventoryDate));
    res.json(rows);
  } catch (err) { next(err); }
});

router.put("/accommodation-rooms/:id/inventory", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = InventoryBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_INVENTORY")); return; }
    const [room] = await db.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(
      eq(accommodationRoomsTable.id, req.params.id),
      eq(accommodationRoomsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!room) { next(new NotFoundError("Quarto não encontrado", "ROOM_NOT_FOUND")); return; }
    const id = generateId();
    await db.insert(accommodationRoomInventoryTable).values({
      id,
      tenantId: me.tenantId,
      roomId: room.id,
      inventoryDate: parsed.data.inventoryDate,
      status: parsed.data.status,
      capacityOverride: parsed.data.capacityOverride ?? null,
      blockedReason: parsed.data.blockedReason ?? null,
      maintenanceReason: parsed.data.maintenanceReason ?? null,
    }).onConflictDoUpdate({
      target: [accommodationRoomInventoryTable.roomId, accommodationRoomInventoryTable.inventoryDate],
      set: {
        status: parsed.data.status,
        capacityOverride: parsed.data.capacityOverride ?? null,
        blockedReason: parsed.data.blockedReason ?? null,
        maintenanceReason: parsed.data.maintenanceReason ?? null,
        updatedAt: new Date(),
      },
    });
    const [row] = await db.select().from(accommodationRoomInventoryTable).where(and(
      eq(accommodationRoomInventoryTable.tenantId, me.tenantId),
      eq(accommodationRoomInventoryTable.roomId, room.id),
      eq(accommodationRoomInventoryTable.inventoryDate, parsed.data.inventoryDate),
    )).limit(1);
    res.json(row);
  } catch (err) { next(err); }
});

router.get("/accommodations/:id/availability", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await findAccommodation(me.tenantId, req.params.id);
    const checkIn = String(req.query.checkIn ?? "");
    const checkOut = String(req.query.checkOut ?? "");
    assertDateRange(checkIn, checkOut);
    const rooms = await db.select().from(accommodationRoomsTable).where(and(
      eq(accommodationRoomsTable.tenantId, me.tenantId),
      eq(accommodationRoomsTable.accommodationId, req.params.id),
    )).orderBy(asc(accommodationRoomsTable.name));
    const activeStays = await db.select({ id: accommodationStaysTable.id }).from(accommodationStaysTable).where(and(
      eq(accommodationStaysTable.tenantId, me.tenantId),
      eq(accommodationStaysTable.accommodationId, req.params.id),
      inArray(accommodationStaysTable.status, ACTIVE_STAY_STATUSES),
      overlaps(checkIn, checkOut),
    ));
    const stayIds = activeStays.map(stay => stay.id);
    const assignments = stayIds.length === 0 ? [] : await db.select({
      roomId: accommodationRoomAssignmentsTable.roomId,
    }).from(accommodationRoomAssignmentsTable).where(and(
      eq(accommodationRoomAssignmentsTable.tenantId, me.tenantId),
      inArray(accommodationRoomAssignmentsTable.stayId, stayIds),
      eq(accommodationRoomAssignmentsTable.status, "active"),
      lt(accommodationRoomAssignmentsTable.checkIn, checkOut),
      gt(accommodationRoomAssignmentsTable.checkOut, checkIn),
      isNull(accommodationRoomAssignmentsTable.unassignedAt),
    ));
    const legacyAssignments = await db.select({
      roomId: reservationRoomAssignmentsTable.roomId,
    }).from(reservationRoomAssignmentsTable)
      .innerJoin(reservationsTable, eq(reservationsTable.id, reservationRoomAssignmentsTable.reservationId))
      .innerJoin(tripsTable, eq(tripsTable.id, reservationRoomAssignmentsTable.tripId))
      .where(and(
        eq(reservationRoomAssignmentsTable.tenantId, me.tenantId),
        eq(tripsTable.accommodationId, req.params.id),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
        lt(tripsTable.departureDate, new Date(`${checkOut}T12:00:00Z`)),
        gt(tripsTable.returnDate, new Date(`${checkIn}T12:00:00Z`)),
      ));
    const inventoryRows = await db.select({
      roomId: accommodationRoomInventoryTable.roomId,
      inventoryDate: accommodationRoomInventoryTable.inventoryDate,
      status: accommodationRoomInventoryTable.status,
      capacityOverride: accommodationRoomInventoryTable.capacityOverride,
    }).from(accommodationRoomInventoryTable).where(and(
      eq(accommodationRoomInventoryTable.tenantId, me.tenantId),
      gte(accommodationRoomInventoryTable.inventoryDate, checkIn),
      lt(accommodationRoomInventoryTable.inventoryDate, checkOut),
      inArray(accommodationRoomInventoryTable.roomId, rooms.map(room => room.id)),
    ));
    const blockedRooms = await db.select({ roomId: accommodationRoomBlocksTable.roomId }).from(accommodationRoomBlocksTable).where(and(
      eq(accommodationRoomBlocksTable.tenantId, me.tenantId),
      eq(accommodationRoomBlocksTable.accommodationId, req.params.id),
      eq(accommodationRoomBlocksTable.status, "active"),
      lt(accommodationRoomBlocksTable.startDate, checkOut),
      gt(accommodationRoomBlocksTable.endDate, checkIn),
    ));
    const blockedRoomIds = new Set(blockedRooms.flatMap(row => row.roomId ? [row.roomId] : rooms.map(room => room.id)));
    const assignmentCounts = new Map<string, number>();
    for (const assignment of assignments) assignmentCounts.set(assignment.roomId, (assignmentCounts.get(assignment.roomId) ?? 0) + 1);
    for (const assignment of legacyAssignments) assignmentCounts.set(assignment.roomId, (assignmentCounts.get(assignment.roomId) ?? 0) + 1);
    const inventoryByRoom = new Map<string, typeof inventoryRows>();
    for (const row of inventoryRows) {
      const rows = inventoryByRoom.get(row.roomId) ?? [];
      rows.push(row);
      inventoryByRoom.set(row.roomId, rows);
    }
    res.json({
      accommodationId: req.params.id,
      checkIn,
      checkOut,
      nights: assertDateRange(checkIn, checkOut),
      rooms: rooms.map(room => {
        const used = assignmentCounts.get(room.id) ?? 0;
        const roomInventory = inventoryByRoom.get(room.id) ?? [];
        const inventoryBlocked = roomInventory.some(row => row.status !== "available");
        const capacity = roomInventory.reduce(
          (minimum, row) => row.capacityOverride == null ? minimum : Math.min(minimum, row.capacityOverride),
          room.capacity,
        );
        const blocked = blockedRoomIds.has(room.id) || inventoryBlocked || room.status !== "active" || room.isActive === false;
        return { ...formatRoom(room), occupied: used, capacity, available: blocked ? 0 : Math.max(0, capacity - used), blocked };
      }),
    });
  } catch (err) { next(err); }
});

router.get("/trips/:tripId/accommodations", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const rows = await db.select().from(tripAccommodationsTable).where(and(
      eq(tripAccommodationsTable.tenantId, me.tenantId),
      eq(tripAccommodationsTable.tripId, req.params.tripId),
    )).orderBy(desc(tripAccommodationsTable.isPrimary), asc(tripAccommodationsTable.checkIn));
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/trips/:tripId/accommodations", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = TripAccommodationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_TRIP_ACCOMMODATION")); return; }
    const nights = assertDateRange(parsed.data.checkIn, parsed.data.checkOut);
    await findAccommodation(me.tenantId, parsed.data.accommodationId);
    const id = generateId();
    await db.transaction(async tx => {
      if (parsed.data.isPrimary) {
        await tx.update(tripAccommodationsTable).set({ isPrimary: false }).where(and(
          eq(tripAccommodationsTable.tenantId, me.tenantId),
          eq(tripAccommodationsTable.tripId, req.params.tripId),
        ));
      }
      await tx.insert(tripAccommodationsTable).values({
        id, tenantId: me.tenantId, tripId: req.params.tripId,
        accommodationId: parsed.data.accommodationId, checkIn: parsed.data.checkIn, checkOut: parsed.data.checkOut,
        nights, status: parsed.data.status ?? "active", isPrimary: parsed.data.isPrimary ?? false,
        pricingPolicy: parsed.data.pricingPolicy ?? "CURRENT_RATE",
        contractedPrice: parsed.data.contractedPrice == null ? null : String(parsed.data.contractedPrice),
        notes: parsed.data.notes ?? null,
      });
    });
    const [row] = await db.select().from(tripAccommodationsTable).where(eq(tripAccommodationsTable.id, id)).limit(1);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.post("/accommodation-stays", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = StayBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_STAY")); return; }
    const nights = assertDateRange(parsed.data.checkIn, parsed.data.checkOut);
    await findAccommodation(me.tenantId, parsed.data.accommodationId);
    if (parsed.data.assignments && parsed.data.assignments.some(item => item.guestIndex >= parsed.data.guests.length)) {
      next(new ValidationError("A alocação aponta para um hóspede inexistente", "INVALID_ASSIGNMENT")); return;
    }
    const stayId = generateId();
    const result = await db.transaction(async tx => {
      const assignments = parsed.data.assignments ?? [];
      const byRoom = new Map<string, number>();
      for (const assignment of assignments) byRoom.set(assignment.roomId, (byRoom.get(assignment.roomId) ?? 0) + 1);
      const rooms = new Map<string, typeof accommodationRoomsTable.$inferSelect>();
      for (const [roomId, count] of byRoom) {
        const room = await ensureRoomCanReceiveGuests(tx, me.tenantId, parsed.data.accommodationId, roomId, parsed.data.checkIn, parsed.data.checkOut, count);
        rooms.set(roomId, room);
      }
      await tx.insert(accommodationStaysTable).values({
        id: stayId, tenantId: me.tenantId, accommodationId: parsed.data.accommodationId,
        tripAccommodationId: parsed.data.tripAccommodationId ?? null, tripId: parsed.data.tripId ?? null,
        reservationId: parsed.data.reservationId ?? null, storeOrderId: parsed.data.storeOrderId ?? null,
        clientId: parsed.data.clientId ?? null, source: parsed.data.source,
        checkIn: parsed.data.checkIn, checkOut: parsed.data.checkOut, nights,
        status: parsed.data.status, pricingType: parsed.data.pricingType ?? null, notes: parsed.data.notes ?? null,
      });
      const guestIds: string[] = [];
      for (const guest of parsed.data.guests) {
        const guestId = generateId();
        guestIds.push(guestId);
        await tx.insert(accommodationStayGuestsTable).values({
          id: guestId, tenantId: me.tenantId, stayId, name: guest.name,
          document: guest.document ?? null, guestType: guest.guestType ?? "adult", passengerId: guest.passengerId ?? null,
        });
      }
      const totals = { value: 0, complete: true };
      for (const assignment of assignments) {
        const room = rooms.get(assignment.roomId);
        if (!room) continue;
        const guestId = guestIds[assignment.guestIndex]!;
        const [bed] = assignment.bedId ? await tx.select({ id: accommodationRoomBedsTable.id }).from(accommodationRoomBedsTable).where(and(
          eq(accommodationRoomBedsTable.id, assignment.bedId), eq(accommodationRoomBedsTable.roomId, room.id),
        )).limit(1) : [];
        if (assignment.bedId && !bed) throw new ValidationError("Cama não pertence ao quarto", "BED_NOT_FOUND");
        await tx.insert(accommodationRoomAssignmentsTable).values({
          id: generateId(), tenantId: me.tenantId, stayId, stayGuestId: guestId, roomId: room.id, bedId: assignment.bedId ?? null,
          checkIn: parsed.data.checkIn, checkOut: parsed.data.checkOut, assignedBy: me.id,
        });
      }
      for (const [roomId, count] of byRoom) {
        const room = rooms.get(roomId)!;
        const rate = await chooseRate(tx, me.tenantId, parsed.data.accommodationId, room, parsed.data.checkIn, parsed.data.checkOut, nights, count, parsed.data.reservationId);
        const pricingType = rate?.pricingType ?? parsed.data.pricingType ?? (room.pricePerNight == null ? null : "PER_ROOM");
        const unitPrice = rate ? Number(rate.amount) : room.pricePerNight == null ? null : Number(room.pricePerNight);
        if (pricingType && unitPrice != null) {
          const quantity = pricingType === "PER_PERSON" || pricingType === "PER_BED" ? count : 1;
          const subtotal = Math.round(unitPrice * quantity * nights * 100) / 100;
          totals.value += subtotal;
          await tx.insert(accommodationStayRateLinesTable).values({
            id: generateId(), tenantId: me.tenantId, stayId, roomId, rateId: rate?.id ?? null,
            pricingType, unitPrice: String(unitPrice), quantity, nights, subtotal: String(subtotal),
          });
        } else {
          totals.complete = false;
        }
      }
      await tx.update(accommodationStaysTable).set({
        contractedTotal: totals.complete ? String(totals.value) : null,
        frozenTotal: totals.complete ? String(totals.value) : null,
      }).where(eq(accommodationStaysTable.id, stayId));
      return { guestIds, total: totals.complete ? totals.value : null };
    });
    const [stay] = await db.select().from(accommodationStaysTable).where(eq(accommodationStaysTable.id, stayId)).limit(1);
    if (!stay) throw new AppError("Falha ao criar estadia", 500, "STAY_CREATE_FAILED");
    res.status(201).json({ ...formatStay(stay), ...result });
  } catch (err) { next(err); }
});

router.get("/accommodation-stays/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [stay] = await db.select().from(accommodationStaysTable).where(and(
      eq(accommodationStaysTable.id, req.params.id), eq(accommodationStaysTable.tenantId, me.tenantId),
    )).limit(1);
    if (!stay) { next(new NotFoundError("Estadia não encontrada", "STAY_NOT_FOUND")); return; }
    const [guests, assignments, rateLines] = await Promise.all([
      db.select().from(accommodationStayGuestsTable).where(eq(accommodationStayGuestsTable.stayId, stay.id)),
      db.select().from(accommodationRoomAssignmentsTable).where(eq(accommodationRoomAssignmentsTable.stayId, stay.id)).orderBy(desc(accommodationRoomAssignmentsTable.assignedAt)),
      db.select().from(accommodationStayRateLinesTable).where(eq(accommodationStayRateLinesTable.stayId, stay.id)),
    ]);
    res.json({
      ...formatStay(stay),
      guests,
      assignments,
      rateLines: rateLines.map(line => ({ ...line, unitPrice: Number(line.unitPrice), subtotal: Number(line.subtotal) })),
    });
  } catch (err) { next(err); }
});

router.get("/accommodation-stays", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const conditions = [eq(accommodationStaysTable.tenantId, me.tenantId)];
    if (typeof req.query.accommodationId === "string") conditions.push(eq(accommodationStaysTable.accommodationId, req.query.accommodationId));
    if (typeof req.query.tripId === "string") conditions.push(eq(accommodationStaysTable.tripId, req.query.tripId));
    if (typeof req.query.status === "string") conditions.push(eq(accommodationStaysTable.status, req.query.status));
    const stays = await db.select().from(accommodationStaysTable).where(and(...conditions)).orderBy(desc(accommodationStaysTable.createdAt)).limit(500);
    res.json(stays.map(formatStay));
  } catch (err) { next(err); }
});

router.post("/accommodation-stays/:id/check-in", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [stay] = await db.select().from(accommodationStaysTable).where(and(eq(accommodationStaysTable.id, req.params.id), eq(accommodationStaysTable.tenantId, me.tenantId))).limit(1);
    if (!stay) { next(new NotFoundError("Estadia não encontrada", "STAY_NOT_FOUND")); return; }
    if (["cancelled", "checked_out", "no_show"].includes(stay.status)) { next(new ValidationError("A estadia não pode receber check-in neste estado", "INVALID_STAY_STATUS")); return; }
    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(accommodationStaysTable).set({ status: "checked_in", actualCheckInAt: now }).where(eq(accommodationStaysTable.id, stay.id));
      await tx.update(accommodationStayGuestsTable).set({ status: "checked_in", actualCheckInAt: now }).where(eq(accommodationStayGuestsTable.stayId, stay.id));
    });
    const [updated] = await db.select().from(accommodationStaysTable).where(eq(accommodationStaysTable.id, stay.id)).limit(1);
    res.json(formatStay(updated!));
  } catch (err) { next(err); }
});

router.post("/accommodation-stays/:id/check-out", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [stay] = await db.select().from(accommodationStaysTable).where(and(eq(accommodationStaysTable.id, req.params.id), eq(accommodationStaysTable.tenantId, me.tenantId))).limit(1);
    if (!stay) { next(new NotFoundError("Estadia não encontrada", "STAY_NOT_FOUND")); return; }
    if (stay.status === "cancelled") { next(new ValidationError("A estadia está cancelada", "INVALID_STAY_STATUS")); return; }
    const now = new Date();
    await db.transaction(async tx => {
      await tx.update(accommodationStaysTable).set({ status: "checked_out", actualCheckOutAt: now }).where(eq(accommodationStaysTable.id, stay.id));
      await tx.update(accommodationStayGuestsTable).set({ status: "checked_out", actualCheckOutAt: now }).where(eq(accommodationStayGuestsTable.stayId, stay.id));
      await tx.update(accommodationRoomAssignmentsTable).set({ status: "completed", unassignedAt: now, unassignedBy: me.id }).where(and(eq(accommodationRoomAssignmentsTable.stayId, stay.id), isNull(accommodationRoomAssignmentsTable.unassignedAt)));
    });
    const [updated] = await db.select().from(accommodationStaysTable).where(eq(accommodationStaysTable.id, stay.id)).limit(1);
    res.json(formatStay(updated!));
  } catch (err) { next(err); }
});

router.get("/accommodation-stays/:id/room-assignments", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const [stay] = await db.select().from(accommodationStaysTable).where(and(eq(accommodationStaysTable.id, req.params.id), eq(accommodationStaysTable.tenantId, me.tenantId))).limit(1);
    if (!stay) { next(new NotFoundError("Estadia não encontrada", "STAY_NOT_FOUND")); return; }
    const [guests, assignments] = await Promise.all([
      db.select().from(accommodationStayGuestsTable).where(eq(accommodationStayGuestsTable.stayId, stay.id)),
      db.select().from(accommodationRoomAssignmentsTable).where(and(eq(accommodationRoomAssignmentsTable.stayId, stay.id), isNull(accommodationRoomAssignmentsTable.unassignedAt))),
    ]);
    res.json({ stay: formatStay(stay), guests, assignments });
  } catch (err) { next(err); }
});

router.put("/accommodation-stays/:id/room-assignments", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = AssignmentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "INVALID_ASSIGNMENT")); return; }
    const [stay] = await db.select().from(accommodationStaysTable).where(and(eq(accommodationStaysTable.id, req.params.id), eq(accommodationStaysTable.tenantId, me.tenantId))).limit(1);
    if (!stay) { next(new NotFoundError("Estadia não encontrada", "STAY_NOT_FOUND")); return; }
    const uniqueGuests = new Set(parsed.data.assignments.map(item => item.guestId));
    if (uniqueGuests.size !== parsed.data.assignments.length) { next(new ValidationError("Um hóspede não pode ocupar dois quartos ativos", "DUPLICATE_GUEST_ASSIGNMENT")); return; }
    await db.transaction(async tx => {
      await tx.update(accommodationRoomAssignmentsTable).set({
        status: "replaced", unassignedAt: new Date(), unassignedBy: me.id, changeReason: "Atualização da alocação",
      }).where(and(eq(accommodationRoomAssignmentsTable.stayId, stay.id), isNull(accommodationRoomAssignmentsTable.unassignedAt)));
      const byRoom = new Map<string, number>();
      for (const item of parsed.data.assignments) byRoom.set(item.roomId, (byRoom.get(item.roomId) ?? 0) + 1);
      for (const [roomId, count] of byRoom) await ensureRoomCanReceiveGuests(tx, me.tenantId, stay.accommodationId, roomId, stay.checkIn, stay.checkOut, count, stay.id);
      const guestIds = await tx.select({ id: accommodationStayGuestsTable.id }).from(accommodationStayGuestsTable).where(and(
        eq(accommodationStayGuestsTable.stayId, stay.id), inArray(accommodationStayGuestsTable.id, [...uniqueGuests]),
      ));
      if (guestIds.length !== uniqueGuests.size) throw new ValidationError("Hóspede não pertence à estadia", "GUEST_NOT_FOUND");
      for (const item of parsed.data.assignments) {
        const [room] = await tx.select({ id: accommodationRoomsTable.id }).from(accommodationRoomsTable).where(and(eq(accommodationRoomsTable.id, item.roomId), eq(accommodationRoomsTable.accommodationId, stay.accommodationId))).limit(1);
        if (!room) throw new ValidationError("Quarto não pertence à hospedagem", "ROOM_NOT_FOUND");
        if (item.bedId) {
          const [bed] = await tx.select({ id: accommodationRoomBedsTable.id }).from(accommodationRoomBedsTable).where(and(eq(accommodationRoomBedsTable.id, item.bedId), eq(accommodationRoomBedsTable.roomId, item.roomId))).limit(1);
          if (!bed) throw new ValidationError("Cama não pertence ao quarto", "BED_NOT_FOUND");
        }
        await tx.insert(accommodationRoomAssignmentsTable).values({
          id: generateId(), tenantId: me.tenantId, stayId: stay.id, stayGuestId: item.guestId,
          roomId: item.roomId, bedId: item.bedId ?? null, checkIn: stay.checkIn, checkOut: stay.checkOut, assignedBy: me.id,
        });
      }
    });
    const assignments = await db.select().from(accommodationRoomAssignmentsTable).where(and(eq(accommodationRoomAssignmentsTable.stayId, stay.id), isNull(accommodationRoomAssignmentsTable.unassignedAt)));
    res.json({ assignments });
  } catch (err) { next(err); }
});

export default router;