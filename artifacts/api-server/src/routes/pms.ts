import { Router, type NextFunction } from "express";
import { createHash } from "node:crypto";
import {
  db,
  propertiesTable,
  roomTypesTable,
  accommodationUnitsTable,
  ratePlansTable,
  pmsReservationsTable,
  pmsReservationUnitsTable,
  pmsReservationGuestsTable,
  accommodationsTable,
  accommodationRoomsTable,
  accommodationRatesTable,
  accommodationRoomBlocksTable,
  accommodationRoomInventoryTable,
  accommodationStaysTable,
  accommodationRoomAssignmentsTable,
  reservationRoomAssignmentsTable,
  reservationsTable,
  tripsTable,
} from "@workspace/db";
import { ACTIVE_RESERVATION_STATUSES } from "@workspace/permissions";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/tenant";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_PMS_RESERVATION_STATUSES = ["HELD", "CONFIRMED"];
const ACTIVE_STAY_STATUSES = ["held", "confirmed", "checked_in", "in_house"];
type PmsExecutor = Pick<typeof db, "select" | "insert" | "update">;

const ReservationItemBody = z.object({
  roomTypeId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
  adults: z.number().int().min(1).max(100).default(1),
  children: z.number().int().min(0).max(100).default(0),
  unitPrice: z.number().nonnegative().optional(),
  ratePlanId: z.string().optional().nullable(),
});

const GuestBody = z.object({
  fullName: z.string().trim().min(1).max(180),
  documentType: z.string().trim().max(30).optional().nullable(),
  documentNumber: z.string().trim().max(80).optional().nullable(),
  birthDate: z.string().regex(DATE_RE).optional().nullable(),
  guestType: z.enum(["ADULT", "CHILD", "INFANT"]).default("ADULT"),
  itemIndex: z.number().int().min(0).optional(),
});

const CreateReservationBody = z.object({
  propertyId: z.string().min(1),
  clientId: z.string().optional().nullable(),
  source: z.string().trim().min(1).max(40).default("DIRECT"),
  channel: z.string().trim().min(1).max(40).default("CRM"),
  checkIn: z.string().regex(DATE_RE),
  checkOut: z.string().regex(DATE_RE),
  adults: z.number().int().min(1).max(500).default(1),
  children: z.number().int().min(0).max(500).default(0),
  infants: z.number().int().min(0).max(500).default(0),
  currency: z.string().length(3).default("BRL"),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(ReservationItemBody).min(1).max(50),
  guests: z.array(GuestBody).max(500).default([]),
});

const AddGuestsBody = z.object({
  guests: z.array(GuestBody.omit({ itemIndex: true })).min(1).max(500),
});

const UpdateReservationBody = z.object({
  checkIn: z.string().regex(DATE_RE).optional(),
  checkOut: z.string().regex(DATE_RE).optional(),
  adults: z.number().int().min(1).max(500).optional(),
  children: z.number().int().min(0).max(500).optional(),
  infants: z.number().int().min(0).max(500).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(ReservationItemBody).min(1).max(50).optional(),
  guests: z.array(GuestBody).max(500).optional(),
}).refine(value => Object.keys(value).length > 0, {
  message: "Informe ao menos um campo para alterar",
});

const CancelReservationBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

const AssignmentsBody = z.object({
  assignments: z.array(z.object({
    reservationUnitId: z.string().min(1),
    unitId: z.string().min(1).nullable(),
  })).max(100),
});

function assertDateRange(checkIn: string, checkOut: string): number {
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
    throw new ValidationError("Use datas no formato AAAA-MM-DD", "INVALID_DATE");
  }
  const start = new Date(`${checkIn}T12:00:00Z`);
  const end = new Date(`${checkOut}T12:00:00Z`);
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (nights < 1) {
    throw new ValidationError("O check-out deve ser posterior ao check-in", "INVALID_STAY_PERIOD");
  }
  return nights;
}

function overlaps(checkIn: string, checkOut: string) {
  return and(
    lt(pmsReservationUnitsTable.checkIn, checkOut),
    gt(pmsReservationUnitsTable.checkOut, checkIn),
  );
}

function formatProperty(property: typeof propertiesTable.$inferSelect) {
  return {
    ...property,
    createdAt: property.createdAt.toISOString(),
    updatedAt: property.updatedAt.toISOString(),
  };
}

function formatReservation(reservation: typeof pmsReservationsTable.$inferSelect) {
  return {
    ...reservation,
    totalAmount: Number(reservation.totalAmount),
    paidAmount: Number(reservation.paidAmount),
    balanceAmount: Number(reservation.balanceAmount),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    expiresAt: reservation.expiresAt?.toISOString() ?? null,
  };
}

type ReservationItemInput = z.infer<typeof ReservationItemBody>;

async function prepareReservationItems(
  exec: PmsExecutor,
  tenantId: string,
  property: typeof propertiesTable.$inferSelect,
  items: ReservationItemInput[],
  checkIn: string,
  checkOut: string,
  excludedReservationId?: string,
) {
  const nights = assertDateRange(checkIn, checkOut);
  const roomTypeIds = [...new Set(items.map(item => item.roomTypeId))].sort();
  const roomTypes = await exec.select().from(roomTypesTable).where(and(
    eq(roomTypesTable.tenantId, tenantId),
    eq(roomTypesTable.propertyId, property.id),
    inArray(roomTypesTable.id, roomTypeIds),
    eq(roomTypesTable.status, "active"),
  ));
  if (roomTypes.length !== roomTypeIds.length) {
    throw new ValidationError("Um dos tipos de quarto não pertence à propriedade", "PMS_ROOM_TYPE_NOT_FOUND");
  }

  const requestedByType = new Map<string, number>();
  for (const item of items) {
    requestedByType.set(item.roomTypeId, (requestedByType.get(item.roomTypeId) ?? 0) + item.quantity);
  }
  for (const roomTypeId of roomTypeIds) {
    await exec.select({ id: roomTypesTable.id }).from(roomTypesTable).where(and(
      eq(roomTypesTable.tenantId, tenantId),
      eq(roomTypesTable.id, roomTypeId),
    )).for("update").limit(1);
    const availability = await getTypeAvailability(
      exec,
      tenantId,
      property.id,
      roomTypeId,
      checkIn,
      checkOut,
      excludedReservationId,
    );
    if (availability.availableUnits < (requestedByType.get(roomTypeId) ?? 0)) {
      throw new ConflictError(
        "Não há unidades suficientes para o tipo de quarto selecionado",
        "PMS_INSUFFICIENT_AVAILABILITY",
      );
    }
  }

  const prepared = [];
  for (const item of items) {
    const unitPrice = item.unitPrice ?? await chooseLegacyRate(
      exec,
      tenantId,
      property,
      item.roomTypeId,
      checkIn,
      checkOut,
    );
    prepared.push({
      ...item,
      unitPrice,
      total: Number((unitPrice * nights * item.quantity).toFixed(2)),
    });
  }
  return {
    nights,
    items: prepared,
    totalAmount: Number(prepared.reduce((sum, item) => sum + item.total, 0).toFixed(2)),
  };
}

function legacyRoomTypeHash(accommodationId: string, category: string) {
  return createHash("md5").update(`${accommodationId}:${category.toLowerCase()}`).digest("hex");
}

async function ensureLegacyProjection(tenantId: string) {
  await db.transaction(async tx => {
    const accommodations = await tx.select().from(accommodationsTable).where(
      eq(accommodationsTable.tenantId, tenantId),
    );
    if (accommodations.length === 0) return;

    await tx.insert(propertiesTable).values(accommodations.map(accommodation => ({
      id: `legacy-property-${accommodation.id}`,
      tenantId,
      legacyAccommodationId: accommodation.id,
      name: accommodation.name,
      tradeName: accommodation.name,
      propertyType: accommodation.type.toUpperCase(),
      email: accommodation.email ?? null,
      phone: accommodation.phone ?? null,
      address: accommodation.address ?? null,
      city: accommodation.city ?? null,
      state: accommodation.state ?? null,
      currency: "BRL",
      status: accommodation.status,
      createdAt: accommodation.createdAt,
      updatedAt: accommodation.updatedAt,
    }))).onConflictDoNothing();

    const rooms = await tx.select().from(accommodationRoomsTable).where(
      eq(accommodationRoomsTable.tenantId, tenantId),
    );
    const roomTypeValues = new Map<string, typeof roomTypesTable.$inferInsert>();
    for (const room of rooms) {
      const key = `${room.accommodationId}:${room.category.toLowerCase()}`;
      if (roomTypeValues.has(key)) continue;
      roomTypeValues.set(key, {
        id: `legacy-room-type-${legacyRoomTypeHash(room.accommodationId, room.category)}`,
        tenantId,
        propertyId: `legacy-property-${room.accommodationId}`,
        legacyCategory: room.category,
        name: room.category.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase()),
        code: `LEGACY_${legacyRoomTypeHash(room.accommodationId, room.category)}`,
        maxOccupancy: room.capacity,
        baseOccupancy: room.standardOccupancy ?? room.capacity,
        defaultPrice: room.pricePerNight ?? null,
        status: "active",
      });
    }
    if (roomTypeValues.size > 0) {
      await tx.insert(roomTypesTable).values([...roomTypeValues.values()]).onConflictDoNothing();
    }

    if (rooms.length > 0) {
      await tx.insert(accommodationUnitsTable).values(rooms.map(room => ({
        id: `legacy-unit-${room.id}`,
        tenantId,
        propertyId: `legacy-property-${room.accommodationId}`,
        roomTypeId: `legacy-room-type-${legacyRoomTypeHash(room.accommodationId, room.category)}`,
        legacyRoomId: room.id,
        unitNumber: room.name,
        name: room.name,
        floor: room.floor ?? null,
        maxOccupancy: room.capacity,
        status: room.isActive && room.status === "active" ? "active" : "inactive",
        housekeepingStatus: "CLEAN",
        maintenanceStatus: "AVAILABLE",
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
      }))).onConflictDoNothing();
    }

    await tx.insert(ratePlansTable).values(accommodations.map(accommodation => ({
      id: `legacy-rate-plan-legacy-property-${accommodation.id}`,
      tenantId,
      propertyId: `legacy-property-${accommodation.id}`,
      name: "Tarifa pública",
      code: "BAR",
      pricingModel: "PER_ROOM",
      status: "active",
    }))).onConflictDoNothing();
  });
}

async function findProperty(tenantId: string, propertyId: string) {
  const [property] = await db.select().from(propertiesTable).where(and(
    eq(propertiesTable.id, propertyId),
    eq(propertiesTable.tenantId, tenantId),
  )).limit(1);
  if (!property) throw new NotFoundError("Propriedade não encontrada", "PMS_PROPERTY_NOT_FOUND");
  return property;
}

async function legacyRoomIsUnavailable(
  exec: PmsExecutor,
  tenantId: string,
  unit: typeof accommodationUnitsTable.$inferSelect,
  checkIn: string,
  checkOut: string,
  excludedReservationId?: string,
) {
  if (!unit.legacyRoomId) return false;

  const [block] = await exec.select({ id: accommodationRoomBlocksTable.id })
    .from(accommodationRoomBlocksTable)
    .where(and(
      eq(accommodationRoomBlocksTable.tenantId, tenantId),
      eq(accommodationRoomBlocksTable.roomId, unit.legacyRoomId),
      eq(accommodationRoomBlocksTable.status, "active"),
      lt(accommodationRoomBlocksTable.startDate, checkOut),
      gt(accommodationRoomBlocksTable.endDate, checkIn),
    ))
    .limit(1);
  if (block) return true;

  const [inventoryBlock] = await exec.select({ id: accommodationRoomInventoryTable.id })
    .from(accommodationRoomInventoryTable)
    .where(and(
      eq(accommodationRoomInventoryTable.tenantId, tenantId),
      eq(accommodationRoomInventoryTable.roomId, unit.legacyRoomId),
      ne(accommodationRoomInventoryTable.status, "available"),
      gte(accommodationRoomInventoryTable.inventoryDate, checkIn),
      lt(accommodationRoomInventoryTable.inventoryDate, checkOut),
    ))
    .limit(1);
  if (inventoryBlock) return true;

  const [stayAssignment] = await exec.select({ id: accommodationRoomAssignmentsTable.id })
    .from(accommodationRoomAssignmentsTable)
    .innerJoin(accommodationStaysTable, eq(
      accommodationStaysTable.id,
      accommodationRoomAssignmentsTable.stayId,
    ))
    .where(and(
      eq(accommodationRoomAssignmentsTable.tenantId, tenantId),
      eq(accommodationRoomAssignmentsTable.roomId, unit.legacyRoomId),
      eq(accommodationRoomAssignmentsTable.status, "active"),
      isNull(accommodationRoomAssignmentsTable.unassignedAt),
      inArray(accommodationStaysTable.status, ACTIVE_STAY_STATUSES),
      lt(accommodationRoomAssignmentsTable.checkIn, checkOut),
      gt(accommodationRoomAssignmentsTable.checkOut, checkIn),
    ))
    .limit(1);
  if (stayAssignment) return true;

  const [legacyAssignment] = await exec.select({ id: reservationRoomAssignmentsTable.id })
    .from(reservationRoomAssignmentsTable)
    .innerJoin(reservationsTable, eq(
      reservationsTable.id,
      reservationRoomAssignmentsTable.reservationId,
    ))
    .innerJoin(tripsTable, eq(tripsTable.id, reservationRoomAssignmentsTable.tripId))
    .where(and(
      eq(reservationRoomAssignmentsTable.tenantId, tenantId),
      eq(reservationRoomAssignmentsTable.roomId, unit.legacyRoomId),
      inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      lt(tripsTable.departureDate, new Date(`${checkOut}T12:00:00Z`)),
      gt(tripsTable.returnDate, new Date(`${checkIn}T12:00:00Z`)),
    ))
    .limit(1);
  if (legacyAssignment) return true;

  const [pmsAssignment] = await exec.select({ id: pmsReservationUnitsTable.id })
    .from(pmsReservationUnitsTable)
    .innerJoin(pmsReservationsTable, eq(
      pmsReservationsTable.id,
      pmsReservationUnitsTable.reservationId,
    ))
    .where(and(
      eq(pmsReservationUnitsTable.tenantId, tenantId),
      eq(pmsReservationUnitsTable.unitId, unit.id),
      overlaps(checkIn, checkOut),
      inArray(pmsReservationsTable.status, ACTIVE_PMS_RESERVATION_STATUSES),
      excludedReservationId ? ne(pmsReservationsTable.id, excludedReservationId) : sql`true`,
      or(
        isNull(pmsReservationsTable.expiresAt),
        gt(pmsReservationsTable.expiresAt, new Date()),
      ),
    ))
    .limit(1);
  return Boolean(pmsAssignment);
}

async function listTypeUnits(
  exec: PmsExecutor,
  tenantId: string,
  propertyId: string,
  roomTypeId: string,
) {
  return exec.select().from(accommodationUnitsTable).where(and(
    eq(accommodationUnitsTable.tenantId, tenantId),
    eq(accommodationUnitsTable.propertyId, propertyId),
    eq(accommodationUnitsTable.roomTypeId, roomTypeId),
    eq(accommodationUnitsTable.status, "active"),
  ));
}

async function getTypeAvailability(
  exec: PmsExecutor,
  tenantId: string,
  propertyId: string,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  excludedReservationId?: string,
) {
  const units = await listTypeUnits(exec, tenantId, propertyId, roomTypeId);
  let unavailable = 0;
  for (const unit of units) {
    if (await legacyRoomIsUnavailable(exec, tenantId, unit, checkIn, checkOut, excludedReservationId)) {
      unavailable++;
    }
  }

  const [reservedRow] = await exec.select({
    quantity: sql<number>`coalesce(sum(${pmsReservationUnitsTable.quantity}), 0)`,
  })
    .from(pmsReservationUnitsTable)
    .innerJoin(pmsReservationsTable, eq(
      pmsReservationsTable.id,
      pmsReservationUnitsTable.reservationId,
    ))
    .where(and(
      eq(pmsReservationUnitsTable.tenantId, tenantId),
      eq(pmsReservationUnitsTable.roomTypeId, roomTypeId),
      isNull(pmsReservationUnitsTable.unitId),
      overlaps(checkIn, checkOut),
      inArray(pmsReservationsTable.status, ACTIVE_PMS_RESERVATION_STATUSES),
      excludedReservationId ? ne(pmsReservationsTable.id, excludedReservationId) : sql`true`,
      or(
        isNull(pmsReservationsTable.expiresAt),
        gt(pmsReservationsTable.expiresAt, new Date()),
      ),
    ));

  const held = Number(reservedRow?.quantity ?? 0);
  return {
    totalUnits: units.length,
    unavailableUnits: unavailable,
    heldUnits: held,
    availableUnits: Math.max(0, units.length - unavailable - held),
    units,
  };
}

async function chooseLegacyRate(
  exec: PmsExecutor,
  tenantId: string,
  property: typeof propertiesTable.$inferSelect,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
) {
  const [roomType] = await exec.select().from(roomTypesTable).where(and(
    eq(roomTypesTable.id, roomTypeId),
    eq(roomTypesTable.tenantId, tenantId),
    eq(roomTypesTable.propertyId, property.id),
  )).limit(1);
  if (!roomType) throw new ValidationError("Tipo de quarto inválido para a propriedade", "PMS_ROOM_TYPE_NOT_FOUND");

  if (property.legacyAccommodationId) {
    const rates = await exec.select().from(accommodationRatesTable).where(and(
      eq(accommodationRatesTable.tenantId, tenantId),
      eq(accommodationRatesTable.accommodationId, property.legacyAccommodationId),
      eq(accommodationRatesTable.status, "active"),
      lte(accommodationRatesTable.validFrom, checkIn),
      gte(accommodationRatesTable.validTo, checkOut),
      or(
        isNull(accommodationRatesTable.category),
        eq(accommodationRatesTable.category, roomType.legacyCategory ?? ""),
      ),
    ));
    const rate = rates.sort((a, b) => b.priority - a.priority)[0];
    if (rate) return Number(rate.amount);
  }
  return roomType.defaultPrice == null ? 0 : Number(roomType.defaultPrice);
}

async function getReservationDetail(tenantId: string, id: string) {
  const [reservation] = await db.select({
    reservation: pmsReservationsTable,
    property: propertiesTable,
  }).from(pmsReservationsTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, pmsReservationsTable.propertyId))
    .where(and(
      eq(pmsReservationsTable.id, id),
      eq(pmsReservationsTable.tenantId, tenantId),
      eq(propertiesTable.tenantId, tenantId),
    ))
    .limit(1);
  if (!reservation) throw new NotFoundError("Reserva PMS não encontrada", "PMS_RESERVATION_NOT_FOUND");

  const units = await db.select({
    item: pmsReservationUnitsTable,
    roomType: roomTypesTable,
    unit: accommodationUnitsTable,
  }).from(pmsReservationUnitsTable)
    .innerJoin(roomTypesTable, eq(roomTypesTable.id, pmsReservationUnitsTable.roomTypeId))
    .leftJoin(accommodationUnitsTable, eq(accommodationUnitsTable.id, pmsReservationUnitsTable.unitId))
    .where(and(
      eq(pmsReservationUnitsTable.tenantId, tenantId),
      eq(pmsReservationUnitsTable.reservationId, id),
    ))
    .orderBy(asc(pmsReservationUnitsTable.createdAt));

  const guests = await db.select().from(pmsReservationGuestsTable).where(and(
    eq(pmsReservationGuestsTable.tenantId, tenantId),
    eq(pmsReservationGuestsTable.reservationId, id),
  )).orderBy(asc(pmsReservationGuestsTable.createdAt));

  return {
    reservation: formatReservation(reservation.reservation),
    property: formatProperty(reservation.property),
    items: units.map(({ item, roomType, unit }) => ({
      ...item,
      unitPrice: Number(item.unitPrice),
      total: Number(item.total),
      roomType: { id: roomType.id, name: roomType.name, code: roomType.code },
      unit: unit ? { id: unit.id, name: unit.name, unitNumber: unit.unitNumber } : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    guests: guests.map(guest => ({
      ...guest,
      createdAt: guest.createdAt.toISOString(),
      updatedAt: guest.updatedAt.toISOString(),
    })),
  };
}

router.get("/pms/properties", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureLegacyProjection(me.tenantId);
    const properties = await db.select().from(propertiesTable).where(and(
      eq(propertiesTable.tenantId, me.tenantId),
      eq(propertiesTable.status, "active"),
    )).orderBy(asc(propertiesTable.name));
    res.json(properties.map(formatProperty));
  } catch (err) {
    next(err);
  }
});

router.get("/pms/properties/:id/room-types", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureLegacyProjection(me.tenantId);
    await findProperty(me.tenantId, req.params.id);
    const types = await db.select().from(roomTypesTable).where(and(
      eq(roomTypesTable.tenantId, me.tenantId),
      eq(roomTypesTable.propertyId, req.params.id),
      eq(roomTypesTable.status, "active"),
    )).orderBy(asc(roomTypesTable.name));
    res.json(types.map(type => ({
      ...type,
      defaultPrice: type.defaultPrice == null ? null : Number(type.defaultPrice),
      createdAt: type.createdAt.toISOString(),
      updatedAt: type.updatedAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/pms/properties/:id/units", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureLegacyProjection(me.tenantId);
    await findProperty(me.tenantId, req.params.id);
    const units = await db.select({
      unit: accommodationUnitsTable,
      roomType: roomTypesTable,
    }).from(accommodationUnitsTable)
      .innerJoin(roomTypesTable, eq(roomTypesTable.id, accommodationUnitsTable.roomTypeId))
      .where(and(
        eq(accommodationUnitsTable.tenantId, me.tenantId),
        eq(accommodationUnitsTable.propertyId, req.params.id),
        eq(accommodationUnitsTable.status, "active"),
      ))
      .orderBy(asc(roomTypesTable.name), asc(accommodationUnitsTable.unitNumber));
    res.json(units.map(({ unit, roomType }) => ({
      ...unit,
      roomType: { id: roomType.id, name: roomType.name, code: roomType.code },
      createdAt: unit.createdAt.toISOString(),
      updatedAt: unit.updatedAt.toISOString(),
    })));
  } catch (err) {
    next(err);
  }
});

 router.get("/pms/availability", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureLegacyProjection(me.tenantId);
    const propertyId = String(req.query.propertyId ?? "");
    const checkIn = String(req.query.checkIn ?? "");
    const checkOut = String(req.query.checkOut ?? "");
    const excludedReservationId = typeof req.query.excludeReservationId === "string"
      ? req.query.excludeReservationId
      : undefined;
    const nights = assertDateRange(checkIn, checkOut);
    const property = await findProperty(me.tenantId, propertyId);
    const types = await db.select().from(roomTypesTable).where(and(
      eq(roomTypesTable.tenantId, me.tenantId),
      eq(roomTypesTable.propertyId, propertyId),
      eq(roomTypesTable.status, "active"),
    )).orderBy(asc(roomTypesTable.name));

    const roomTypes = [];
    for (const roomType of types) {
      const availability = await getTypeAvailability(
        db,
        me.tenantId,
        propertyId,
        roomType.id,
        checkIn,
        checkOut,
        excludedReservationId,
      );
      const price = await chooseLegacyRate(db, me.tenantId, property, roomType.id, checkIn, checkOut);
      roomTypes.push({
        id: roomType.id,
        name: roomType.name,
        code: roomType.code,
        maxOccupancy: roomType.maxOccupancy,
        totalUnits: availability.totalUnits,
        availableUnits: availability.availableUnits,
        pricePerNight: price,
        totalForStay: Number((price * nights).toFixed(2)),
      });
    }
    res.json({ property: formatProperty(property), checkIn, checkOut, nights, roomTypes });
  } catch (err) {
    next(err);
  }
});

router.get("/pms/reservations", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
    const filters = [
      eq(pmsReservationsTable.tenantId, me.tenantId),
      propertyId ? eq(pmsReservationsTable.propertyId, propertyId) : sql`true`,
      status ? eq(pmsReservationsTable.status, status) : sql`true`,
    ];
    const rows = await db.select({
      reservation: pmsReservationsTable,
      property: propertiesTable,
    }).from(pmsReservationsTable)
      .innerJoin(propertiesTable, eq(propertiesTable.id, pmsReservationsTable.propertyId))
      .where(and(...filters))
      .orderBy(desc(pmsReservationsTable.createdAt))
      .limit(limit);
    res.json(rows.map(({ reservation, property }) => ({
      ...formatReservation(reservation),
      property: { id: property.id, name: property.name },
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/pms/reservations/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    res.json(await getReservationDetail(me.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/pms/reservations", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    await ensureLegacyProjection(me.tenantId);
    const parsed = CreateReservationBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message, "INVALID_PMS_RESERVATION");
    }
    const data = parsed.data;
    assertDateRange(data.checkIn, data.checkOut);
    const property = await findProperty(me.tenantId, data.propertyId);
    const reservationId = generateId();
    const reservationNumber = `PMS-${data.checkIn.replaceAll("-", "")}-${reservationId.slice(0, 8).toUpperCase()}`;

    await db.transaction(async tx => {
      const prepared = await prepareReservationItems(
        tx,
        me.tenantId,
        property,
        data.items,
        data.checkIn,
        data.checkOut,
      );
      const totalAmount = prepared.totalAmount;
      await tx.insert(pmsReservationsTable).values({
        id: reservationId,
        tenantId: me.tenantId,
        propertyId: data.propertyId,
        clientId: data.clientId ?? null,
        reservationNumber,
        source: data.source,
        channel: data.channel,
        status: "CONFIRMED",
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        adults: data.adults,
        children: data.children,
        infants: data.infants,
        totalAmount: totalAmount.toFixed(2),
        paidAmount: "0.00",
        balanceAmount: totalAmount.toFixed(2),
        currency: data.currency.toUpperCase(),
        notes: data.notes ?? null,
      });

      const insertedItems = [];
      for (const item of prepared.items) {
        const itemId = generateId();
        await tx.insert(pmsReservationUnitsTable).values({
          id: itemId,
          tenantId: me.tenantId,
          reservationId,
          roomTypeId: item.roomTypeId,
          unitId: null,
          ratePlanId: item.ratePlanId ?? null,
          checkIn: data.checkIn,
          checkOut: data.checkOut,
          adults: item.adults,
          children: item.children,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          total: item.total.toFixed(2),
        });
        insertedItems.push(itemId);
      }

      for (const guest of data.guests) {
        if (guest.itemIndex !== undefined && !insertedItems[guest.itemIndex]) {
          throw new ValidationError("Hóspede associado a um item inexistente", "INVALID_PMS_GUEST_ITEM");
        }
        await tx.insert(pmsReservationGuestsTable).values({
          id: generateId(),
          tenantId: me.tenantId,
          reservationId,
          reservationUnitId: guest.itemIndex === undefined ? null : insertedItems[guest.itemIndex],
          guestProfileId: null,
          fullName: guest.fullName,
          documentType: guest.documentType ?? null,
          documentNumber: guest.documentNumber ?? null,
          birthDate: guest.birthDate ?? null,
          guestType: guest.guestType,
        });
      }
    });

    res.status(201).json(await getReservationDetail(me.tenantId, reservationId));
  } catch (err) {
    next(err);
  }
});

router.patch("/pms/reservations/:id", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = UpdateReservationBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.message, "INVALID_PMS_RESERVATION_UPDATE");
    const data = parsed.data;

    await db.transaction(async tx => {
      const [reservation] = await tx.select().from(pmsReservationsTable).where(and(
        eq(pmsReservationsTable.id, req.params.id),
        eq(pmsReservationsTable.tenantId, me.tenantId),
      )).for("update").limit(1);
      if (!reservation) throw new NotFoundError("Reserva PMS não encontrada", "PMS_RESERVATION_NOT_FOUND");
      if (["CANCELLED", "EXPIRED"].includes(reservation.status)) {
        throw new ValidationError("Não é possível alterar uma reserva encerrada", "PMS_RESERVATION_CLOSED");
      }

      const property = await findProperty(me.tenantId, reservation.propertyId);
      const checkIn = data.checkIn ?? reservation.checkIn;
      const checkOut = data.checkOut ?? reservation.checkOut;
      const currentItems = await tx.select().from(pmsReservationUnitsTable).where(and(
        eq(pmsReservationUnitsTable.tenantId, me.tenantId),
        eq(pmsReservationUnitsTable.reservationId, reservation.id),
      )).orderBy(asc(pmsReservationUnitsTable.createdAt));
      const requestedItems: ReservationItemInput[] = data.items ?? currentItems.map(item => ({
        roomTypeId: item.roomTypeId,
        quantity: item.quantity,
        adults: item.adults,
        children: item.children,
        unitPrice: Number(item.unitPrice),
        ratePlanId: item.ratePlanId,
      }));
      const prepared = await prepareReservationItems(
        tx,
        me.tenantId,
        property,
        requestedItems,
        checkIn,
        checkOut,
        reservation.id,
      );
      const itemIds: string[] = [];

      if (data.items) {
        await tx.delete(pmsReservationUnitsTable).where(and(
          eq(pmsReservationUnitsTable.tenantId, me.tenantId),
          eq(pmsReservationUnitsTable.reservationId, reservation.id),
        ));
        for (let index = 0; index < prepared.items.length; index++) {
          const item = prepared.items[index];
          const previous = currentItems[index];
          let unitId: string | null = null;
          if (
            previous?.unitId &&
            previous.roomTypeId === item.roomTypeId &&
            previous.quantity === item.quantity
          ) {
            const [unit] = await tx.select().from(accommodationUnitsTable).where(and(
              eq(accommodationUnitsTable.id, previous.unitId),
              eq(accommodationUnitsTable.tenantId, me.tenantId),
              eq(accommodationUnitsTable.propertyId, reservation.propertyId),
              eq(accommodationUnitsTable.roomTypeId, item.roomTypeId),
              eq(accommodationUnitsTable.status, "active"),
            )).for("update").limit(1);
            if (unit && !(await legacyRoomIsUnavailable(
              tx,
              me.tenantId,
              unit,
              checkIn,
              checkOut,
              reservation.id,
            ))) {
              unitId = unit.id;
            }
          }
          const itemId = generateId();
          itemIds.push(itemId);
          await tx.insert(pmsReservationUnitsTable).values({
            id: itemId,
            tenantId: me.tenantId,
            reservationId: reservation.id,
            roomTypeId: item.roomTypeId,
            unitId,
            ratePlanId: item.ratePlanId ?? null,
            checkIn,
            checkOut,
            adults: item.adults,
            children: item.children,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toFixed(2),
            total: item.total.toFixed(2),
          });
        }
      } else {
        itemIds.push(...currentItems.map(item => item.id));
        for (let index = 0; index < prepared.items.length; index++) {
          const item = prepared.items[index];
          await tx.update(pmsReservationUnitsTable).set({
            checkIn,
            checkOut,
            unitPrice: item.unitPrice.toFixed(2),
            total: item.total.toFixed(2),
          }).where(and(
            eq(pmsReservationUnitsTable.id, currentItems[index].id),
            eq(pmsReservationUnitsTable.tenantId, me.tenantId),
          ));
        }
      }

      if (data.guests) {
        await tx.delete(pmsReservationGuestsTable).where(and(
          eq(pmsReservationGuestsTable.tenantId, me.tenantId),
          eq(pmsReservationGuestsTable.reservationId, reservation.id),
        ));
        for (const guest of data.guests) {
          if (guest.itemIndex !== undefined && !itemIds[guest.itemIndex]) {
            throw new ValidationError("Hóspede associado a um item inexistente", "INVALID_PMS_GUEST_ITEM");
          }
          await tx.insert(pmsReservationGuestsTable).values({
            id: generateId(),
            tenantId: me.tenantId,
            reservationId: reservation.id,
            reservationUnitId: guest.itemIndex === undefined ? null : itemIds[guest.itemIndex],
            guestProfileId: null,
            fullName: guest.fullName,
            documentType: guest.documentType ?? null,
            documentNumber: guest.documentNumber ?? null,
            birthDate: guest.birthDate ?? null,
            guestType: guest.guestType,
          });
        }
      }

      const paidAmount = Number(reservation.paidAmount);
      const balanceAmount = Math.max(0, prepared.totalAmount - paidAmount);
      await tx.update(pmsReservationsTable).set({
        checkIn,
        checkOut,
        adults: data.adults ?? reservation.adults,
        children: data.children ?? reservation.children,
        infants: data.infants ?? reservation.infants,
        totalAmount: prepared.totalAmount.toFixed(2),
        balanceAmount: balanceAmount.toFixed(2),
        notes: data.notes === undefined ? reservation.notes : data.notes,
        updatedAt: new Date(),
      }).where(and(
        eq(pmsReservationsTable.id, reservation.id),
        eq(pmsReservationsTable.tenantId, me.tenantId),
      ));
    });

    res.json(await getReservationDetail(me.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/pms/reservations/:id/cancel", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CancelReservationBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.message, "INVALID_PMS_CANCELLATION");

    await db.transaction(async tx => {
      const [reservation] = await tx.select().from(pmsReservationsTable).where(and(
        eq(pmsReservationsTable.id, req.params.id),
        eq(pmsReservationsTable.tenantId, me.tenantId),
      )).for("update").limit(1);
      if (!reservation) throw new NotFoundError("Reserva PMS não encontrada", "PMS_RESERVATION_NOT_FOUND");
      if (reservation.status === "CANCELLED") return;
      if (reservation.status === "EXPIRED") {
        throw new ValidationError("A reserva já expirou e não pode ser cancelada", "PMS_RESERVATION_CLOSED");
      }
      await tx.update(pmsReservationsTable).set({
        status: "CANCELLED",
        cancellationReason: parsed.data.reason,
        expiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(pmsReservationsTable.id, reservation.id),
        eq(pmsReservationsTable.tenantId, me.tenantId),
      ));
    });

    res.json(await getReservationDetail(me.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/pms/reservations/:id/guests", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = AddGuestsBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.message, "INVALID_PMS_GUESTS");
    const [reservation] = await db.select().from(pmsReservationsTable).where(and(
      eq(pmsReservationsTable.id, req.params.id),
      eq(pmsReservationsTable.tenantId, me.tenantId),
    )).limit(1);
    if (!reservation) throw new NotFoundError("Reserva PMS não encontrada", "PMS_RESERVATION_NOT_FOUND");
    if (["CANCELLED", "EXPIRED"].includes(reservation.status)) {
      throw new ValidationError("Não é possível adicionar hóspedes a uma reserva encerrada", "PMS_RESERVATION_CLOSED");
    }
    await db.insert(pmsReservationGuestsTable).values(parsed.data.guests.map(guest => ({
      id: generateId(),
      tenantId: me.tenantId,
      reservationId: reservation.id,
      reservationUnitId: null,
      guestProfileId: null,
      fullName: guest.fullName,
      documentType: guest.documentType ?? null,
      documentNumber: guest.documentNumber ?? null,
      birthDate: guest.birthDate ?? null,
      guestType: guest.guestType,
    })));
    res.status(201).json(await getReservationDetail(me.tenantId, reservation.id));
  } catch (err) {
    next(err);
  }
});

router.put("/pms/reservations/:id/assignments", async (req, res, next: NextFunction) => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = AssignmentsBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.message, "INVALID_PMS_ASSIGNMENTS");

    await db.transaction(async tx => {
      const [reservation] = await tx.select().from(pmsReservationsTable).where(and(
        eq(pmsReservationsTable.id, req.params.id),
        eq(pmsReservationsTable.tenantId, me.tenantId),
      )).for("update").limit(1);
      if (!reservation) throw new NotFoundError("Reserva PMS não encontrada", "PMS_RESERVATION_NOT_FOUND");
      if (["CANCELLED", "EXPIRED"].includes(reservation.status)) {
        throw new ValidationError("Não é possível alterar uma reserva encerrada", "PMS_RESERVATION_CLOSED");
      }

      const items = await tx.select().from(pmsReservationUnitsTable).where(and(
        eq(pmsReservationUnitsTable.tenantId, me.tenantId),
        eq(pmsReservationUnitsTable.reservationId, reservation.id),
      ));
      const itemMap = new Map(items.map(item => [item.id, item]));

      for (const assignment of parsed.data.assignments) {
        const item = itemMap.get(assignment.reservationUnitId);
        if (!item) throw new NotFoundError("Item da reserva não encontrado", "PMS_RESERVATION_ITEM_NOT_FOUND");
        if (!assignment.unitId) {
          await tx.update(pmsReservationUnitsTable).set({ unitId: null }).where(and(
            eq(pmsReservationUnitsTable.id, item.id),
            eq(pmsReservationUnitsTable.tenantId, me.tenantId),
          ));
          continue;
        }

        const [unit] = await tx.select().from(accommodationUnitsTable).where(and(
          eq(accommodationUnitsTable.id, assignment.unitId),
          eq(accommodationUnitsTable.tenantId, me.tenantId),
          eq(accommodationUnitsTable.propertyId, reservation.propertyId),
          eq(accommodationUnitsTable.roomTypeId, item.roomTypeId),
          eq(accommodationUnitsTable.status, "active"),
        )).for("update").limit(1);
        if (!unit) throw new ValidationError("Unidade inválida para este item", "PMS_UNIT_NOT_FOUND");
        if (await legacyRoomIsUnavailable(
          tx,
          me.tenantId,
          unit,
          reservation.checkIn,
          reservation.checkOut,
          reservation.id,
        )) {
          throw new ConflictError("A unidade já está ocupada ou bloqueada no período", "PMS_UNIT_NOT_AVAILABLE");
        }
        await tx.update(pmsReservationUnitsTable).set({ unitId: unit.id }).where(and(
          eq(pmsReservationUnitsTable.id, item.id),
          eq(pmsReservationUnitsTable.tenantId, me.tenantId),
        ));
      }
    });

    res.json(await getReservationDetail(me.tenantId, req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;