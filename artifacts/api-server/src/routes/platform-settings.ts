import { Router, type NextFunction } from "express";
import { db, platformSettingsTable, redisAlertLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";
import { ROLES } from "@workspace/permissions";
import { z } from "zod/v4";

const router = Router();

const STRIPE_ALERT_EMAIL_KEY = "stripe_health_alert_email";
const EMAIL_SETTING_KEYS = new Set(["redis_alert_email", STRIPE_ALERT_EMAIL_KEY]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UpdatePlatformSettingBody = z.object({
  value: z.union([z.string(), z.null()]).optional(),
});

router.get("/admin/platform-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const settings = await db.select().from(platformSettingsTable).orderBy(platformSettingsTable.key);
    const fallbackValue = process.env["SUPERADMIN_EMAIL"]?.trim() || null;
    const stripeAlertSetting = settings.find((setting) => setting.key === STRIPE_ALERT_EMAIL_KEY);

    if (stripeAlertSetting) {
      res.json(settings.map((setting) => (
        setting.key === STRIPE_ALERT_EMAIL_KEY
          ? { ...setting, fallbackValue }
          : setting
      )));
      return;
    }

    // This setting must be visible even before an operator saves an override.
    // The virtual row is persisted on the first PUT request below.
    res.json([
      ...settings,
      {
        id: STRIPE_ALERT_EMAIL_KEY,
        key: STRIPE_ALERT_EMAIL_KEY,
        value: null,
        fallbackValue,
        label: "E-mail de alerta de saúde do Stripe",
        description: "Recebe alertas quando um plano pago não tem preço Stripe válido. Deixe em branco para usar o e-mail padrão da plataforma.",
        type: "string",
        updatedAt: new Date(),
      },
    ]);
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
    const isEmailSetting = EMAIL_SETTING_KEYS.has(key);
    const normalizedValue = isEmailSetting ? value?.trim() || null : value;

    if (isEmailSetting && normalizedValue !== null && normalizedValue !== undefined) {
      if (!EMAIL_REGEX.test(normalizedValue.trim())) {
        next(new ValidationError("Endereço de e-mail inválido", "VALIDATION_ERROR"));
        return;
      }
    }

    const existing = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key)).limit(1);

    if (existing.length === 0 && key !== STRIPE_ALERT_EMAIL_KEY) {
      next(new NotFoundError("Setting not found", "NOT_FOUND"));
      return;
    }

    if (existing.length === 0) {
      const [created] = await db
        .insert(platformSettingsTable)
        .values({
          id: generateId(),
          key: STRIPE_ALERT_EMAIL_KEY,
          value: normalizedValue ?? null,
          label: "E-mail de alerta de saúde do Stripe",
          description: "Recebe alertas quando um plano pago não tem preço Stripe válido. Deixe em branco para usar o e-mail padrão da plataforma.",
          type: "string",
        })
        .returning();
      res.status(201).json(created);
      return;
    }

    const [updated] = await db
      .update(platformSettingsTable)
      .set({ value: normalizedValue !== undefined ? String(normalizedValue) : null })
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
