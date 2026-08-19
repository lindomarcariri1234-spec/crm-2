import { Router, type NextFunction } from "express";
import { db, platformSettingsTable, redisAlertLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";
import { ROLES } from "@workspace/permissions";
import { z } from "zod/v4";

const router = Router();

const UpdatePlatformSettingBody = z.object({
  value: z.union([z.string(), z.null()]).optional(),
});

router.get("/admin/platform-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const settings = await db.select().from(platformSettingsTable).orderBy(platformSettingsTable.key);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put("/admin/platform-settings/:key", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { key } = req.params;
    const parsed = UpdatePlatformSettingBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("value deve ser uma string ou null", "VALIDATION_ERROR"));
      return;
    }
    const { value } = parsed.data;

    if (key === "redis_alert_email" && value !== null && value !== undefined && String(value).trim() !== "") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(value).trim())) {
        next(new ValidationError("Endereço de e-mail inválido", "VALIDATION_ERROR"));
        return;
      }
    }

    const existing = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key)).limit(1);

    if (existing.length === 0) {
      next(new NotFoundError("Setting not found", "NOT_FOUND"));
      return;
    }

    const [updated] = await db
      .update(platformSettingsTable)
      .set({ value: value !== undefined ? String(value) : null })
      .where(eq(platformSettingsTable.key, key))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/admin/redis-alert-log", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const logs = await db
      .select()
      .from(redisAlertLogTable)
      .orderBy(desc(redisAlertLogTable.triggeredAt))
      .limit(20);

    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
