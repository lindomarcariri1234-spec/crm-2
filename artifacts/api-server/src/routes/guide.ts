import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { emitBoardingUpdate } from "../lib/boarding-sse";
import {
  tripGuideTokensTable,
  tripCheckinsTable,
  tripGuideLocationsTable,
  tripsTable,
  reservationsTable,
  passengersTable,
  clientsTable,
} from "@workspace/db";
import { eq, and, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, MANAGEMENT_ROLES } from "../lib/tenant";
import { createGuideJwt, requireGuideAuth } from "../lib/guide-auth";
import { generateId } from "../lib/id";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

function generateGuideCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const { randomInt } = require("crypto");
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
  return code;
}

// ─── Admin: generate guide access token ───────────────────────────────────────

router.post("/trips/:id/guide-tokens", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return;
    }
    const { guideName } = z.object({ guideName: z.string().min(1, "Nome do guia obrigatório") }).parse(req.body);
    const [trip] = await db.select({ id: tripsTable.id, name: tripsTable.name })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id!), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }

    let token = generateGuideCode();
    for (let attempts = 0; attempts < 5; attempts++) {
      const [existing] = await db.select({ id: tripGuideTokensTable.id })
        .from(tripGuideTokensTable).where(eq(tripGuideTokensTable.token, token)).limit(1);
      if (!existing) break;
      token = generateGuideCode();
    }

    const id = generateId();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(tripGuideTokensTable).values({
      id, tripId: trip.id, tenantId: me.tenantId, guideName, token, expiresAt, createdByUserId: me.id,
    });
    res.status(201).json({ id, token, guideName, tripId: trip.id, tripName: trip.name, expiresAt: expiresAt.toISOString() });
  } catch (err) { next(err); }
});

router.get("/trips/:id/guide-tokens", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role as never)) {
      next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return;
    }
    const tokens = await db.select()
      .from(tripGuideTokensTable)
      .where(and(
        eq(tripGuideTokensTable.tripId, req.params.id!),
        eq(tripGuideTokensTable.tenantId, me.tenantId),
        gt(tripGuideTokensTable.expiresAt, new Date()),
      ));
    res.json({ data: tokens });
  } catch (err) { next(err); }
});

// ─── Guide public auth ─────────────────────────────────────────────────────────

router.post("/guide/auth", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
    const [row] = await db.select()
      .from(tripGuideTokensTable)
      .where(and(
        eq(tripGuideTokensTable.token, code.trim().toUpperCase()),
        gt(tripGuideTokensTable.expiresAt, new Date()),
      ))
      .limit(1);
    if (!row) {
      next(new AppError("Código inválido ou expirado", 401, "GUIDE_CODE_INVALID"));
      return;
    }
    const jwt = createGuideJwt({ tokenId: row.id, tripId: row.tripId, tenantId: row.tenantId, guideName: row.guideName });
    res.json({ token: jwt, tripId: row.tripId, tenantId: row.tenantId, guideName: row.guideName, expiresAt: row.expiresAt.toISOString() });
  } catch (err) { next(err); }
});

// ─── Guide app: read trip + passengers ────────────────────────────────────────

router.get("/guide/trips", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const guide = await requireGuideAuth(req, res);
    if (!guide) return;
    const [trip] = await db.select({
      id: tripsTable.id, name: tripsTable.name, departureDate: tripsTable.departureDate,
      totalCapacity: tripsTable.totalCapacity, destination: tripsTable.destination,
      destinationCity: tripsTable.destinationCity, departureTime: tripsTable.departureTime,
      vehiclePlate: tripsTable.vehiclePlate, status: tripsTable.status,
    })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, guide.tripId), eq(tripsTable.tenantId, guide.tenantId)))
      .limit(1);
    res.json({ data: trip ? [trip] : [] });
  } catch (err) { next(err); }
});

router.get("/guide/trip/:tripId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const guide = await requireGuideAuth(req, res);
    if (!guide) return;
    if (guide.tripId !== req.params.tripId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [trip] = await db.select({
      id: tripsTable.id, name: tripsTable.name, departureDate: tripsTable.departureDate,
      totalCapacity: tripsTable.totalCapacity, destination: tripsTable.destination,
      destinationCity: tripsTable.destinationCity, vehiclePlate: tripsTable.vehiclePlate,
      departureTime: tripsTable.departureTime, boardingPoints: tripsTable.boardingPoints,
      freePassengers: tripsTable.freePassengers, status: tripsTable.status,
    })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, guide.tripId), eq(tripsTable.tenantId, guide.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "NOT_FOUND")); return; }

    const reservations = await db.select({ id: reservationsTable.id, status: reservationsTable.status })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.tripId, guide.tripId), eq(reservationsTable.tenantId, guide.tenantId)));
    const activeResIds = reservations.filter(r => !["cancelled", "refunded"].includes(r.status)).map(r => r.id);

    const passengers = activeResIds.length > 0
      ? await db.select({
          id: passengersTable.id, name: passengersTable.name, cpf: passengersTable.cpf,
          seatNumber: passengersTable.seatNumber, ageCategory: passengersTable.ageCategory,
          reservationId: passengersTable.reservationId, checkedInAt: passengersTable.checkedInAt,
          boardingLocationId: passengersTable.boardingLocationId,
          customerCode: clientsTable.customerCode,
        })
          .from(passengersTable)
          .leftJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
          .leftJoin(clientsTable, eq(reservationsTable.clientId, clientsTable.id))
          .where(inArray(passengersTable.reservationId, activeResIds))
      : [];

    const checkins = await db.select()
      .from(tripCheckinsTable)
      .where(and(eq(tripCheckinsTable.tripId, guide.tripId), eq(tripCheckinsTable.tenantId, guide.tenantId)));

    res.json({ trip, passengers, checkins });
  } catch (err) { next(err); }
});

// ─── Guide app: check-in ──────────────────────────────────────────────────────

router.post("/guide/trip/:tripId/checkins", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const guide = await requireGuideAuth(req, res);
    if (!guide) return;
    if (guide.tripId !== req.params.tripId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const { passengerId, reservationId, notes, status } = z.object({
      passengerId: z.string().min(1),
      reservationId: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["present", "absent"]).default("present"),
    }).parse(req.body);

    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, passengerId),
        eq(reservationsTable.tripId, guide.tripId),
        eq(reservationsTable.tenantId, guide.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    const checkedInAt = new Date();
    await db.insert(tripCheckinsTable)
      .values({
        id: generateId(),
        tripId: guide.tripId,
        tenantId: guide.tenantId,
        passengerId,
        reservationId: reservationId ?? null,
        checkedInByUserRef: `guide:${guide.tokenId}:${guide.guideName}`,
        checkedInAt,
        notes: notes ?? null,
        status,
      })
      .onConflictDoUpdate({
        target: [tripCheckinsTable.tripId, tripCheckinsTable.passengerId],
        set: {
          checkedInByUserRef: `guide:${guide.tokenId}:${guide.guideName}`,
          checkedInAt,
          notes: notes ?? null,
          status,
        },
      });

    await db.update(passengersTable)
      .set({ checkedInAt: status === "present" ? checkedInAt : null })
      .where(eq(passengersTable.id, passengerId));

    emitBoardingUpdate(guide.tripId);
    res.status(201).json({ success: true, passengerId, status, checkedInAt: checkedInAt.toISOString() });
  } catch (err) { next(err); }
});

router.delete("/guide/trip/:tripId/checkins/:passengerId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const guide = await requireGuideAuth(req, res);
    if (!guide) return;
    if (guide.tripId !== req.params.tripId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const [passenger] = await db.select({ id: passengersTable.id })
      .from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(passengersTable.id, req.params.passengerId!),
        eq(reservationsTable.tripId, guide.tripId),
        eq(reservationsTable.tenantId, guide.tenantId),
      ))
      .limit(1);
    if (!passenger) { next(new NotFoundError("Passageiro não encontrado", "PASSENGER_NOT_FOUND")); return; }

    await db.delete(tripCheckinsTable)
      .where(and(
        eq(tripCheckinsTable.tripId, guide.tripId),
        eq(tripCheckinsTable.passengerId, req.params.passengerId!),
        eq(tripCheckinsTable.tenantId, guide.tenantId),
      ));
    await db.update(passengersTable)
      .set({ checkedInAt: null })
      .where(eq(passengersTable.id, req.params.passengerId!));
    res.status(204).send();
  } catch (err) { next(err); }
});

// ─── Guide app: location ──────────────────────────────────────────────────────

router.post("/guide/trip/:tripId/location", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const guide = await requireGuideAuth(req, res);
    if (!guide) return;
    if (guide.tripId !== req.params.tripId) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const { lat, lng } = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);

    await db.insert(tripGuideLocationsTable)
      .values({
        tripId: guide.tripId,
        tenantId: guide.tenantId,
        guideUserRef: `guide:${guide.tokenId}`,
        guideName: guide.guideName,
        lat: String(lat),
        lng: String(lng),
        recordedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tripGuideLocationsTable.tripId, tripGuideLocationsTable.tenantId],
        set: {
          guideUserRef: `guide:${guide.tokenId}`,
          guideName: guide.guideName,
          lat: String(lat),
          lng: String(lng),
          recordedAt: new Date(),
        },
      });

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
