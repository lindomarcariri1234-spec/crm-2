import { Router, type NextFunction } from "express";
import { db, clientsTable, birthdayMessagesTable, couponsTable, systemConfigsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { generateId } from "../lib/id";
import { processBirthdayForClient, getBirthdaySettings } from "../lib/birthday";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { localToday } from "@workspace/shared";

const router = Router();

router.get("/birthday/today", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    // Use Brazil calendar date so the "today" birthday list is correct at 21h-midnight BRT
    const [year, month, day] = localToday().split("-").map(Number);

    const allClients = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, me.tenantId), sql`birth_date IS NOT NULL`));

    const todayBirthday = allClients.filter((c) => {
      const bd = c.birthDate!;
      return (bd.getMonth() + 1) === month && bd.getDate() === day;
    });

    const messages = await db
      .select()
      .from(birthdayMessagesTable)
      .where(
        and(
          eq(birthdayMessagesTable.tenantId, me.tenantId),
          eq(birthdayMessagesTable.birthdayYear, year)
        )
      );

    const msgByClient: Record<string, typeof messages[0]> = {};
    for (const m of messages) { msgByClient[m.clientId] = m; }

    const result = todayBirthday.map((c) => ({
      ...c,
      birthdayMessage: msgByClient[c.id] ?? null,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/birthday/upcoming", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const days = Math.min(Number(req.query.days) || 7, 60);
    // Use Brazil calendar date/year so upcoming birthdays are anchored to BRT midnight
    const [year, brMonth1, brDay] = localToday().split("-").map(Number);
    // Brazil midnight (UTC-3) = UTC 03:00; use as anchor for daysUntil math
    const todayMidnightBR = new Date(Date.UTC(year, brMonth1 - 1, brDay, 3, 0, 0, 0));

    const allClients = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, me.tenantId), sql`birth_date IS NOT NULL`));

    const upcoming: Array<{ daysUntil: number; client: typeof allClients[0] }> = [];

    for (const c of allClients) {
      const bd = c.birthDate!;
      // Anchor this year's birthday at Brazil midnight as well for consistent comparison
      const thisYearBd = new Date(Date.UTC(year, bd.getMonth(), bd.getDate(), 3, 0, 0, 0));
      let daysUntil = Math.ceil((thisYearBd.getTime() - todayMidnightBR.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil < 0) {
        const nextYearBd = new Date(Date.UTC(year + 1, bd.getMonth(), bd.getDate(), 3, 0, 0, 0));
        daysUntil = Math.ceil((nextYearBd.getTime() - todayMidnightBR.getTime()) / (1000 * 60 * 60 * 24));
      }
      if (daysUntil <= days && daysUntil > 0) {
        upcoming.push({ daysUntil, client: c });
      }
    }

    upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

    const messages = await db
      .select()
      .from(birthdayMessagesTable)
      .where(
        and(
          eq(birthdayMessagesTable.tenantId, me.tenantId),
          eq(birthdayMessagesTable.birthdayYear, year)
        )
      );
    const msgByClient: Record<string, typeof messages[0]> = {};
    for (const m of messages) { msgByClient[m.clientId] = m; }

    const result = upcoming.map(({ daysUntil, client: c }) => ({
      ...c,
      daysUntil,
      birthdayMessage: msgByClient[c.id] ?? null,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/birthday/history", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let year: number | undefined;
    if (req.query.year !== undefined) {
      const yearNum = Number(req.query.year);
      if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
        next(new ValidationError("Parâmetro inválido: year deve ser um ano inteiro entre 2000 e 2100", "VALIDATION_ERROR"));
        return;
      }
      year = yearNum;
    }

    const conditions = [eq(birthdayMessagesTable.tenantId, me.tenantId)];
    if (year) conditions.push(eq(birthdayMessagesTable.birthdayYear, year));

    const messages = await db
      .select()
      .from(birthdayMessagesTable)
      .where(and(...conditions))
      .orderBy(desc(birthdayMessagesTable.createdAt))
      .limit(limit);

    const clientIds = [...new Set(messages.map((m) => m.clientId))];
    const clients = clientIds.length > 0
      ? await db.select().from(clientsTable).where(
          and(
            eq(clientsTable.tenantId, me.tenantId),
            sql`id = ANY(${clientIds}::text[])`
          )
        )
      : [];

    const clientMap: Record<string, typeof clients[0]> = {};
    for (const c of clients) { clientMap[c.id] = c; }

    const result = messages.map((m) => ({
      ...m,
      client: clientMap[m.clientId] ?? null,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/birthday/stats", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    // Use Brazil calendar date for year/month so birthday stats are correct at night
    const todayBR = localToday(); // "YYYY-MM-DD" in America/Sao_Paulo
    const [year, brMonth1] = todayBR.split("-").map(Number);
    // Brazil midnight = UTC 03:00 (permanently UTC-3, no DST since 2019)
    const startOfMonth = new Date(Date.UTC(year, brMonth1 - 1, 1, 3, 0, 0, 0));

    const allMessages = await db
      .select()
      .from(birthdayMessagesTable)
      .where(
        and(
          eq(birthdayMessagesTable.tenantId, me.tenantId),
          eq(birthdayMessagesTable.birthdayYear, year)
        )
      );

    const thisMonth = allMessages.filter(
      (m) => m.createdAt >= startOfMonth
    );

    const whatsappSent = allMessages.filter((m) => m.sentWhatsapp).length;
    const emailSent = allMessages.filter((m) => m.sentEmail).length;
    const emailOpened = allMessages.filter((m) => m.emailOpened).length;
    const converted = allMessages.filter((m) => m.converted).length;
    const totalSent = allMessages.length;

    const convertedCouponCodes = allMessages
      .filter((m) => m.converted && m.couponCode)
      .map((m) => m.couponCode!);

    let revenueGenerated = 0;
    if (convertedCouponCodes.length > 0) {
      const usedCoupons = await db
        .select({ code: couponsTable.code, value: couponsTable.value })
        .from(couponsTable)
        .where(and(eq(couponsTable.tenantId, me.tenantId), sql`code = ANY(${convertedCouponCodes})`));
      for (const c of usedCoupons) {
        revenueGenerated += Number(c.value) || 0;
      }
    }

    const allClients = await db
      .select({ id: clientsTable.id, birthDate: clientsTable.birthDate })
      .from(clientsTable)
      .where(and(eq(clientsTable.tenantId, me.tenantId), sql`birth_date IS NOT NULL`));

    const [_brYear2, brMonth1Ref, brDayRef] = todayBR.split("-").map(Number);
    const month = brMonth1Ref;
    const day = brDayRef;
    const todayCount = allClients.filter((c) => {
      const bd = c.birthDate!;
      return (bd.getMonth() + 1) === month && bd.getDate() === day;
    }).length;

    // nextWeek and upcomingWeek: use the Brazil-midnight anchor, add 7 days
    const todayMidnight = new Date(Date.UTC(year, brMonth1 - 1, day, 3, 0, 0, 0));
    const nextWeek = new Date(todayMidnight.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingWeek = allClients.filter((c) => {
      const bd = c.birthDate!;
      const thisYearBd = new Date(Date.UTC(year, bd.getMonth(), bd.getDate(), 3, 0, 0, 0));
      return thisYearBd > todayMidnight && thisYearBd <= nextWeek;
    }).length;

    res.json({
      totalSentYear: totalSent,
      sentThisMonth: thisMonth.length,
      whatsappSent,
      emailSent,
      emailOpened,
      converted,
      conversionRate: totalSent > 0 ? Math.round((converted / totalSent) * 100) : 0,
      todayCount,
      upcomingWeek,
      revenueGenerated,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/birthday/:clientId/send", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const result = await processBirthdayForClient(me.tenantId, req.params.clientId, {
      isManual: true,
      sentById: me.id,
    });

    if (!result.success && result.error === "Client not found") {
      next(new NotFoundError("Client not found", "CLIENT_NOT_FOUND"));
      return;
    }

    res.json({ success: result.success, couponCode: result.couponCode, error: result.error });
  } catch (err) {
    next(err);
  }
});

router.post("/birthday/mark-converted", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const { couponCode } = req.body as { couponCode?: string };
    if (!couponCode) { next(new ValidationError("couponCode required", "VALIDATION_ERROR")); return; }

    const [message] = await db
      .select()
      .from(birthdayMessagesTable)
      .where(
        and(
          eq(birthdayMessagesTable.tenantId, me.tenantId),
          eq(birthdayMessagesTable.couponCode, couponCode)
        )
      )
      .limit(1);

    if (!message) { next(new NotFoundError("Birthday message not found", "NOT_FOUND")); return; }

    await db
      .update(birthdayMessagesTable)
      .set({ converted: true })
      .where(eq(birthdayMessagesTable.id, message.id));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/birthday/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const settings = await getBirthdaySettings(me.tenantId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

const BirthdaySettingsBody = z.object({
  enabled: z.boolean().optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  sendWhatsapp: z.boolean().optional(),
  sendEmail: z.boolean().optional(),
  whatsappMessage: z.string().nullable().optional(),
  emailSubject: z.string().nullable().optional(),
  emailMessage: z.string().nullable().optional(),
  senderName: z.string().nullable().optional(),
});

router.put("/birthday/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = BirthdaySettingsBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const current = await getBirthdaySettings(me.tenantId);
    const updated = { ...current, ...parsed.data };

    const existing = await db
      .select()
      .from(systemConfigsTable)
      .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, "birthday_settings")))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(systemConfigsTable)
        .set({ value: updated })
        .where(and(eq(systemConfigsTable.tenantId, me.tenantId), eq(systemConfigsTable.key, "birthday_settings")));
    } else {
      await db.insert(systemConfigsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        key: "birthday_settings",
        value: updated,
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
