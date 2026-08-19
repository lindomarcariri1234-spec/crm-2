import { Router, type NextFunction } from "express";
import { db, couponsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateCouponBody = z.object({
  code: z.string().min(1),
  type: z.enum(["percentage", "fixed"]).optional(),
  value: z.string(),
  minOrderValue: z.string().optional(),
  maxUses: z.number().int().optional(),
  isActive: z.boolean().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
});

router.get("/coupons", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const coupons = await db.select().from(couponsTable)
      .where(eq(couponsTable.tenantId, me.tenantId))
      .orderBy(desc(couponsTable.createdAt));
    res.json(coupons);
  } catch (err) {
    next(err);
  }
});

router.post("/coupons", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateCouponBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(couponsTable).values({
      id, tenantId: me.tenantId, code: parsed.data.code, value: parsed.data.value,
      ...(parsed.data.type && { type: parsed.data.type }),
      ...(parsed.data.minOrderValue && { minOrderValue: parsed.data.minOrderValue }),
      ...(parsed.data.maxUses != null && { maxUses: parsed.data.maxUses }),
      ...(parsed.data.isActive != null && { isActive: parsed.data.isActive }),
      ...(parsed.data.validFrom && { validFrom: new Date(parsed.data.validFrom) }),
      ...(parsed.data.validUntil && { validUntil: new Date(parsed.data.validUntil) }),
    });
    const [coupon] = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
    res.status(201).json(coupon);
  } catch (err) {
    next(err);
  }
});

router.patch("/coupons/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateCouponBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = {};
    if (parsed.data.code) updates.code = parsed.data.code;
    if (parsed.data.type) updates.type = parsed.data.type;
    if (parsed.data.value) updates.value = parsed.data.value;
    if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;
    if (parsed.data.maxUses != null) updates.maxUses = parsed.data.maxUses;
    if (parsed.data.validFrom) updates.validFrom = new Date(parsed.data.validFrom);
    if (parsed.data.validUntil) updates.validUntil = new Date(parsed.data.validUntil);
    await db.update(couponsTable).set(updates)
      .where(and(eq(couponsTable.id, req.params.id), eq(couponsTable.tenantId, me.tenantId)));
    const [coupon] = await db.select().from(couponsTable)
      .where(and(eq(couponsTable.id, req.params.id), eq(couponsTable.tenantId, me.tenantId))).limit(1);
    if (!coupon) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(coupon);
  } catch (err) {
    next(err);
  }
});

router.delete("/coupons/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(couponsTable)
      .where(and(eq(couponsTable.id, req.params.id), eq(couponsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
