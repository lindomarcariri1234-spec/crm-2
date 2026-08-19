import { Router, type NextFunction } from "express";
import { db, systemConfigsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../lib/tenant";
import { ADMIN_ROLES } from "../lib/tenant";
import { ForbiddenError, ValidationError } from "../lib/errors";
import { generateId } from "../lib/id";
import {
  getWhatsAppNotificationSettings,
  type WhatsAppNotificationSettings,
  MAX_BOARDING_REMINDER_DAY,
  MAX_PAGAMENTO_PENDENTE_DAY,
} from "../queues/whatsapp-helpers";

const router = Router();

router.get("/whatsapp-notifications/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const settings = await getWhatsAppNotificationSettings(me.tenantId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

const WhatsAppNotificationSettingsBody = z.object({
  reservationConfirmed: z.boolean().optional(),
  reservationConfirmedMessage: z.string().nullable().optional(),
  paymentReceived: z.boolean().optional(),
  paymentReceivedMessage: z.string().nullable().optional(),
  boardingReminder: z.boolean().optional(),
  boardingReminderMessage: z.string().nullable().optional(),
  // Each day value must be within the worker's query window (D-1..D-14 for boarding,
  // D-1..D-30 for pending payment). Values outside the window would be saved but silently
  // never fire, misleading agency admins.
  boardingReminderDaysBeforeTrip: z.array(
    z.number().int().min(1).max(MAX_BOARDING_REMINDER_DAY),
  ).optional(),
  cadastroRealizado: z.boolean().optional(),
  cadastroRealizadoMessage: z.string().nullable().optional(),
  pagamentoPendente: z.boolean().optional(),
  pagamentoPendenteMessage: z.string().nullable().optional(),
  pagamentoPendenteDaysBeforeTrip: z.number().int().min(1).max(MAX_PAGAMENTO_PENDENTE_DAY).optional(),
});

router.put("/whatsapp-notifications/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = WhatsAppNotificationSettingsBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const current = await getWhatsAppNotificationSettings(me.tenantId);
    const updated: WhatsAppNotificationSettings = { ...current, ...parsed.data };

    const existing = await db
      .select()
      .from(systemConfigsTable)
      .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, "whatsapp_notifications_settings")))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(systemConfigsTable)
        .set({ value: updated })
        .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, "whatsapp_notifications_settings")));
    } else {
      await db.insert(systemConfigsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        key: "whatsapp_notifications_settings",
        value: updated,
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
