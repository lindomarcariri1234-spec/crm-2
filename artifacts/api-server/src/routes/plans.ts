import { Router, type NextFunction } from "express";
import { db, plansTable, featureFlagsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES } from "@workspace/permissions";

const router = Router();

const PlanBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  monthlyPrice: z.string().optional(),
  annualPrice: z.string().optional(),
  maxUsers: z.number().int().optional(),
  maxClients: z.number().int().optional(),
  maxTrips: z.number().int().optional(),
  features: z.array(z.string()).optional(),
  supportedFeatures: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

router.get("/plans", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const plans = await db.select().from(plansTable).orderBy(desc(plansTable.createdAt));
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.post("/plans", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = PlanBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(plansTable).values({ id, ...parsed.data });
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id)).limit(1);
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.get("/plans/list", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const plans = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.isActive, true))
      .orderBy(plansTable.sortOrder);
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.get("/plans/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, req.params.id)).limit(1);
    if (!plan) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.patch("/plans/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = PlanBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    await db.update(plansTable).set(parsed.data).where(eq(plansTable.id, req.params.id));
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, req.params.id)).limit(1);
    if (!plan) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete("/plans/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.update(plansTable).set({ isActive: false }).where(eq(plansTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const FeatureFlagBody = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  isEnabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
});

router.get("/admin/feature-flags", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const flags = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.key);
    res.json(flags);
  } catch (err) {
    next(err);
  }
});

router.post("/admin/feature-flags", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = FeatureFlagBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(featureFlagsTable).values({ id, ...parsed.data });
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, id)).limit(1);
    res.status(201).json(flag);
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/feature-flags/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = FeatureFlagBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    await db.update(featureFlagsTable).set(parsed.data).where(eq(featureFlagsTable.id, req.params.id));
    const [flag] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.id, req.params.id)).limit(1);
    if (!flag) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(flag);
  } catch (err) {
    next(err);
  }
});

export default router;
