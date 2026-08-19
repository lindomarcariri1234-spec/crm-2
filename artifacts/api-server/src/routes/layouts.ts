import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { vehicleLayoutsTable, tripsTable, reservationsTable } from "@workspace/db";
import { eq, and, desc, inArray, notInArray, sql } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors"; 
import type { LayoutCell } from "@workspace/db";
import { CreateLayoutBody, UpdateLayoutBody } from "@workspace/api-zod";
import { ADMIN_ROLES } from '../lib/tenant';

const router = Router();

function countSeats(cells: LayoutCell[]): number {
  return cells.filter(c => c.type === "seat" || c.type === "vip" || c.type === "accessible").length;
}

function formatLayout(l: typeof vehicleLayoutsTable.$inferSelect) {
  const cells = (l.cells ?? []) as LayoutCell[];
  return {
    id: l.id,
    tenantId: l.tenantId,
    name: l.name,
    description: l.description ?? null,
    vehicleType: l.vehicleType ?? null,
    rows: l.rows,
    cols: l.cols,
    floors: l.floors,
    numberingType: l.numberingType,
    cells,
    seatCount: countSeats(cells),
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

router.get("/layouts", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const layouts = await db.select().from(vehicleLayoutsTable)
      .where(eq(vehicleLayoutsTable.tenantId, me.tenantId))
      .orderBy(desc(vehicleLayoutsTable.createdAt));

    res.json(layouts.map(formatLayout));
  } catch (err) {
    next(err);
  }
});

router.post("/layouts", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const parsed = CreateLayoutBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Validation failed", "VALIDATION_ERROR"));
      return;
    }
    const { name, description, vehicleType, rows, cols, floors, numberingType, cells } = parsed.data;

    const id = generateId();
    await db.insert(vehicleLayoutsTable).values({
      id,
      tenantId: me.tenantId,
      name,
      description: description ?? null,
      vehicleType: vehicleType ?? null,
      rows,
      cols,
      floors: floors ?? 1,
      numberingType: numberingType ?? "sequential",
      cells: cells as LayoutCell[],
    });

    const [layout] = await db.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, id), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!layout) { next(new AppError("Resource not found", 404, "NOT_FOUND")); return; }
    res.status(201).json(formatLayout(layout));
  } catch (err) {
    next(err);
  }
});

router.get("/layouts/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const [layout] = await db.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, req.params.id), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!layout) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatLayout(layout));
  } catch (err) {
    next(err);
  }
});

router.put("/layouts/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    const [existing] = await db.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, req.params.id), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!existing) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const parsed = UpdateLayoutBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Validation failed", "VALIDATION_ERROR"));
      return;
    }
    const { name, description, vehicleType, rows, cols, floors, numberingType, cells } = parsed.data;

    const updates: Partial<typeof vehicleLayoutsTable.$inferInsert> = {};
    if (name != null) updates.name = name;
    if (description !== undefined) updates.description = description ?? null;
    if (vehicleType !== undefined) updates.vehicleType = vehicleType ?? null;
    if (rows != null) updates.rows = rows;
    if (cols != null) updates.cols = cols;
    if (floors != null) updates.floors = floors;
    if (numberingType != null) updates.numberingType = numberingType;
    if (cells != null) updates.cells = cells as LayoutCell[];

    await db.update(vehicleLayoutsTable).set(updates)
      .where(and(eq(vehicleLayoutsTable.id, req.params.id), eq(vehicleLayoutsTable.tenantId, me.tenantId)));

    const [layout] = await db.select().from(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, req.params.id), eq(vehicleLayoutsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!layout) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(formatLayout(layout));
  } catch (err) {
    next(err);
  }
});

router.get("/layouts/:id/usage", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const activeTrips = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(
        and(
          eq(tripsTable.tenantId, me.tenantId),
          eq(tripsTable.layoutId, req.params.id),
          notInArray(tripsTable.status, ["cancelled", "completed"]),
        ),
      );

    const activeTripsCount = activeTrips.length;
    let confirmedReservationsCount = 0;

    if (activeTripsCount > 0) {
      const tripIds = activeTrips.map(t => t.id);
      const [row] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tenantId, me.tenantId),
            inArray(reservationsTable.tripId, tripIds),
            inArray(reservationsTable.status, ["confirmed", "completed"]),
          ),
        );
      confirmedReservationsCount = row?.cnt ?? 0;
    }

    res.json({ activeTripsCount, confirmedReservationsCount });
  } catch (err) {
    next(err);
  }
});

router.delete("/layouts/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
      return;
    }

    await db.delete(vehicleLayoutsTable)
      .where(and(eq(vehicleLayoutsTable.id, req.params.id), eq(vehicleLayoutsTable.tenantId, me.tenantId)));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
