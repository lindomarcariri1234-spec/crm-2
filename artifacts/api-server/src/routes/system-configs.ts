import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { systemConfigsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';

const router = Router();


const anyJsonValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]).optional();

const UpsertSystemConfigBody = z.object({
  key: z.string().min(1),
  value: anyJsonValue,
});

router.get("/system-configs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role as (typeof ADMIN_ROLES)[number])) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const configs = await db
      .select()
      .from(systemConfigsTable)
      .where(eq(systemConfigsTable.tenantId, me.tenantId));
    res.json(configs);
  } catch (err) {
    next(err);
  }
});

router.put("/system-configs", async (req, res, next: NextFunction): Promise<void> => {
  return upsertHandler(req, res, next);
});

router.post("/system-configs", async (req, res, next: NextFunction): Promise<void> => {
  return upsertHandler(req, res, next);
});

async function upsertHandler(req: Request, res: Response, next: import("express").NextFunction): Promise<void> {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role as (typeof ADMIN_ROLES)[number])) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const parsed = UpsertSystemConfigBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR"));
      return;
    }
    const { key, value } = parsed.data;
    const [existing] = await db
      .select()
      .from(systemConfigsTable)
      .where(
        and(
          eq(systemConfigsTable.tenantId, me.tenantId),
          eq(systemConfigsTable.key, key),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(systemConfigsTable)
        .set({ value: value ?? null, updatedById: me.id })
        .where(eq(systemConfigsTable.id, existing.id));
      const [updated] = await db
        .select()
        .from(systemConfigsTable)
        .where(eq(systemConfigsTable.id, existing.id))
        .limit(1);
      res.json(updated);
    } else {
      const id = generateId();
      await db.insert(systemConfigsTable).values({
        id,
        tenantId: me.tenantId,
        key,
        value: value ?? null,
        updatedById: me.id,
      });
      const [created] = await db
        .select()
        .from(systemConfigsTable)
        .where(eq(systemConfigsTable.id, id))
        .limit(1);
      res.status(201).json(created);
    }
  } catch (err) {
    next(err);
  }
}

export default router;
