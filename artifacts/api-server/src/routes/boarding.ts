import { Router, type NextFunction } from "express";
import { db, boardingLocationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateBoardingLocationBody = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  reference: z.string().optional(),
  departureTime: z.string().optional(),
});

router.get("/boarding-locations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const locations = await db.select().from(boardingLocationsTable)
      .where(eq(boardingLocationsTable.tenantId, me.tenantId))
      .orderBy(desc(boardingLocationsTable.createdAt));
    res.json(locations);
  } catch (err) {
    next(err);
  }
});

router.post("/boarding-locations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateBoardingLocationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    const id = generateId();
    await db.insert(boardingLocationsTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [loc] = await db.select().from(boardingLocationsTable).where(eq(boardingLocationsTable.id, id)).limit(1);
    res.status(201).json(loc);
  } catch (err) {
    next(err);
  }
});

router.patch("/boarding-locations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateBoardingLocationBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    await db.update(boardingLocationsTable).set(parsed.data)
      .where(and(eq(boardingLocationsTable.id, req.params.id), eq(boardingLocationsTable.tenantId, me.tenantId)));
    const [loc] = await db.select().from(boardingLocationsTable)
      .where(and(eq(boardingLocationsTable.id, req.params.id), eq(boardingLocationsTable.tenantId, me.tenantId))).limit(1);
    if (!loc) { next(new NotFoundError("Boarding location not found", "NOT_FOUND")); return; }
    res.json(loc);
  } catch (err) {
    next(err);
  }
});

router.delete("/boarding-locations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(boardingLocationsTable)
      .where(and(eq(boardingLocationsTable.id, req.params.id), eq(boardingLocationsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
