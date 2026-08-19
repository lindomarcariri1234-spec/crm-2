import { Router, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, calendarEventsTable, tripsTable, paymentsTable, clientsTable } from "@workspace/db";
import { eq, and, count, max } from "drizzle-orm";
import { requireAuth, ALL_STAFF_ROLES } from "../lib/tenant";
import { generateAuthUrl, consumeNonce, exchangeCodeForTokens, revokeToken } from "../lib/google-calendar/calendar-service";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const syncBodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("trip"), id: z.string().min(1) }),
  z.object({ type: z.literal("payment"), id: z.string().min(1) }),
  z.object({ type: z.literal("birthday"), id: z.string().min(1) }),
]);

const router = Router();

const FRONTEND_URL = process.env["FRONTEND_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`;

router.get("/calendar/connect", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) {
      next(new ForbiddenError("Apenas agências e vendedores podem conectar o Google Calendar", "FORBIDDEN_ROLE"));
      return;
    }
    const url = generateAuthUrl(me.id);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

router.get("/calendar/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=denied&tab=integrations`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=error&tab=integrations`);
    return;
  }

  // Require the user to be authenticated. This session-binds the callback:
  // even if an attacker tricks a victim into visiting the attacker's OAuth URL,
  // the callback will reject because the victim's Clerk session does not match
  // the attacker's userId embedded in the state.
  const me = await requireAuth(req, res);
  if (!me) return;

  // consumeNonce verifies the HMAC, confirms the nonce was registered by *this*
  // server during a /calendar/connect call, and deletes it to prevent replay.
  const stateUserId = consumeNonce(state);
  if (!stateUserId) {
    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=error&tab=integrations`);
    return;
  }

  // Session binding: the logged-in user must be the same user who initiated
  // the OAuth flow. Reject if they differ.
  if (me.id !== stateUserId) {
    req.log.warn({ sessionUserId: me.id, stateUserId }, "calendar/callback: session user does not match state userId — possible CSRF or replay");
    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=error&tab=integrations`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    const [user] = await db.select({ id: usersTable.id, tenantId: usersTable.tenantId })
      .from(usersTable).where(eq(usersTable.id, me.id)).limit(1);

    if (!user) {
      res.redirect(`${FRONTEND_URL}/configuracoes?gcal=error&tab=integrations`);
      return;
    }

    const updateFields: Record<string, unknown> = {
      googleAccessToken: tokens.access_token ?? null,
      googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      googleCalendarEnabled: true,
      googleCalendarStatus: "connected",
    };
    if (tokens.refresh_token) {
      updateFields.googleRefreshToken = tokens.refresh_token;
    }
    await db.update(usersTable).set(updateFields).where(eq(usersTable.id, me.id));

    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=success&tab=integrations`);
    CalendarSyncService.syncAllForUser(me.id).catch((err) => {
      req.log.warn({ err, userId: me.id, context: "calendar/callback" }, "Initial syncAllForUser failed — continuing");
    });
  } catch (err) {
    req.log.error({ err }, "calendar/callback failed");
    res.redirect(`${FRONTEND_URL}/configuracoes?gcal=error&tab=integrations`);
  }
});

router.post("/calendar/disconnect", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const [user] = await db.select({ googleAccessToken: usersTable.googleAccessToken })
      .from(usersTable).where(eq(usersTable.id, me.id)).limit(1);

    if (user?.googleAccessToken) {
      await revokeToken(user.googleAccessToken);
    }

    await db.update(usersTable).set({
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
      googleCalendarEnabled: false,
      googleCalendarStatus: "disconnected",
    }).where(eq(usersTable.id, me.id));

    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.userId, me.id));

    res.json({ success: true, message: "Google Calendar desconectado com sucesso" });
  } catch (err) {
    next(err);
  }
});

router.get("/calendar/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const [user] = await db.select({
      googleCalendarEnabled: usersTable.googleCalendarEnabled,
      googleTokenExpiry: usersTable.googleTokenExpiry,
      googleCalendarStatus: usersTable.googleCalendarStatus,
    }).from(usersTable).where(eq(usersTable.id, me.id)).limit(1);

    if (!user?.googleCalendarEnabled) {
      res.json({
        connected: false,
        status: user?.googleCalendarStatus ?? "disconnected",
        eventsCount: 0,
        lastSync: null,
      });
      return;
    }

    const [eventsCountResult] = await db.select({ count: count() })
      .from(calendarEventsTable)
      .where(eq(calendarEventsTable.userId, me.id));

    const [lastSyncResult] = await db.select({ lastSync: max(calendarEventsTable.syncedAt) })
      .from(calendarEventsTable)
      .where(eq(calendarEventsTable.userId, me.id));

    res.json({
      connected: true,
      status: user.googleCalendarStatus,
      tokenValid: user.googleTokenExpiry ? user.googleTokenExpiry > new Date() : true,
      eventsCount: Number(eventsCountResult?.count ?? 0),
      lastSync: lastSyncResult?.lastSync?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/calendar/sync", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) {
      next(new ForbiddenError("Acesso negado", "FORBIDDEN_ROLE"));
      return;
    }

    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR"));
      return;
    }
    const body = parsed.data;

    if (body.type === "trip") {
      const [trip] = await db.select({ id: tripsTable.id })
        .from(tripsTable)
        .where(and(eq(tripsTable.id, body.id), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!trip) { next(new NotFoundError("Viagem não encontrada", "TRIP_NOT_FOUND")); return; }
      await CalendarSyncService.syncTripForUser(body.id, me.id);
      res.json({ success: true, message: "1 evento sincronizado com sucesso", synced: 1 });
    } else if (body.type === "payment") {
      const [payment] = await db.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.id, body.id), eq(paymentsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!payment) { next(new NotFoundError("Pagamento não encontrado", "PAYMENT_NOT_FOUND")); return; }
      await CalendarSyncService.syncPaymentForUser(body.id, me.id);
      res.json({ success: true, message: "1 evento sincronizado com sucesso", synced: 1 });
    } else if (body.type === "birthday") {
      const [client] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, body.id), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!client) { next(new NotFoundError("Cliente não encontrado", "CLIENT_NOT_FOUND")); return; }
      await CalendarSyncService.syncBirthdayForUser(body.id, me.id);
      res.json({ success: true, message: "1 evento sincronizado com sucesso", synced: 1 });
    } else {
      const synced = await CalendarSyncService.syncAllForUser(me.id);
      res.json({ success: true, message: `${synced} evento(s) sincronizado(s) com sucesso`, synced });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
