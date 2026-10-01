import { Router, type NextFunction } from "express";
import { db, commissionRulesTable, commissionsTable, tripsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { ACTIONS, COMMISSION_STATUS, hasPermission, RESOURCES } from "@workspace/permissions";
import { localToday } from "@workspace/shared";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import {
  calculateRuleCommission,
  calculateSellerCommission,
  canTransitionCommissionStatus,
  getCommissionTravelScope,
  selectApplicableCommissionRule,
} from "../lib/commission-calculation.js";

const router = Router();

const COMMISSION_RULE_APPLIES_TO = ["all", "trip", "national", "international"] as const;
const commissionRuleValueSchema = z.string().trim().min(1).refine(
  (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
  "value must be a non-negative number",
);

const CreateRuleBody = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["percentage", "fixed"]).default("percentage"),
  value: commissionRuleValueSchema,
  appliesTo: z.enum(COMMISSION_RULE_APPLIES_TO).default("all"),
  tripId: z.string().trim().min(1).optional(),
  isActive: z.boolean().default(true),
}).strict().superRefine((rule, ctx) => {
  if (rule.appliesTo === "trip" && !rule.tripId) {
    ctx.addIssue({ code: "custom", path: ["tripId"], message: "tripId is required for trip-specific rules" });
  }
  if (rule.appliesTo !== "trip" && rule.tripId) {
    ctx.addIssue({ code: "custom", path: ["tripId"], message: "tripId is only allowed for trip-specific rules" });
  }
});

const UpdateRuleBody = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(["percentage", "fixed"]).optional(),
  value: commissionRuleValueSchema.optional(),
  appliesTo: z.enum(COMMISSION_RULE_APPLIES_TO).optional(),
  tripId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((rule) => Object.keys(rule).length > 0, "At least one rule field is required");

const UpdateCommissionBody = z.object({
  status: z.enum([
    COMMISSION_STATUS.PENDING,
    COMMISSION_STATUS.APPROVED,
    COMMISSION_STATUS.PAID,
    COMMISSION_STATUS.CANCELLED,
  ]),
  paidAt: z.string().datetime().optional(),
}).strict().superRefine((update, ctx) => {
  if (update.paidAt && update.status !== COMMISSION_STATUS.PAID) {
    ctx.addIssue({
      code: "custom",
      path: ["paidAt"],
      message: "paidAt can only be supplied when setting status to paid",
    });
  }
});

async function validateRuleTrip(tenantId: string, tripId: string): Promise<boolean> {
  const [trip] = await db.select({ id: tripsTable.id }).from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
    .limit(1);
  return Boolean(trip);
}

router.get("/commission-rules", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const rules = await db.select().from(commissionRulesTable)
      .where(eq(commissionRulesTable.tenantId, me.tenantId));
    res.json(rules);
  } catch (err) {
    req.log.error({ err }, "Error listing commission rules");
    next(err);
  }
});

router.post("/commission-rules", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.CREATE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateRuleBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    if (
      parsed.data.tripId &&
      !(await validateRuleTrip(me.tenantId, parsed.data.tripId))
    ) {
      next(new ValidationError("The selected trip does not belong to this agency", "INVALID_TRIP_ID"));
      return;
    }
    const id = generateId();
    await db.insert(commissionRulesTable).values({
      id,
      tenantId: me.tenantId,
      ...parsed.data,
      tripId: parsed.data.appliesTo === "trip" ? parsed.data.tripId! : null,
    });
    const [rule] = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.id, id), eq(commissionRulesTable.tenantId, me.tenantId))).limit(1);
    if (!rule) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(rule);
  } catch (err) {
    req.log.error({ err }, "Error creating commission rule");
    next(err);
  }
});

router.patch("/commission-rules/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateRuleBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    const [currentRule] = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.id, req.params.id), eq(commissionRulesTable.tenantId, me.tenantId))).limit(1);
    if (!currentRule) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const appliesTo = parsed.data.appliesTo ?? currentRule.appliesTo;
    const requestedTripId = parsed.data.tripId === undefined ? currentRule.tripId : parsed.data.tripId;
    if (appliesTo === "trip" && !requestedTripId) {
      next(new ValidationError("tripId is required for trip-specific rules", "INVALID_TRIP_ID"));
      return;
    }
    if (appliesTo !== "trip" && parsed.data.tripId) {
      next(new ValidationError("tripId is only allowed for trip-specific rules", "INVALID_TRIP_ID"));
      return;
    }
    const tripId = appliesTo === "trip" ? requestedTripId : null;
    if (tripId && !(await validateRuleTrip(me.tenantId, tripId))) {
      next(new ValidationError("The selected trip does not belong to this agency", "INVALID_TRIP_ID"));
      return;
    }

    await db.update(commissionRulesTable).set({
      ...parsed.data,
      appliesTo,
      tripId,
    }).where(and(eq(commissionRulesTable.id, req.params.id), eq(commissionRulesTable.tenantId, me.tenantId)));
    const [rule] = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.id, req.params.id), eq(commissionRulesTable.tenantId, me.tenantId))).limit(1);
    if (!rule) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(rule);
  } catch (err) {
    req.log.error({ err }, "Error updating commission rule");
    next(err);
  }
});

router.delete("/commission-rules/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.DELETE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(commissionRulesTable)
      .where(and(eq(commissionRulesTable.id, req.params.id), eq(commissionRulesTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting commission rule");
    next(err);
  }
});

router.get("/commissions/calculate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { sellerId, saleAmount, tripId } = req.query as Record<string, string>;
    if (!sellerId || !saleAmount) {
      next(new ValidationError("sellerId and saleAmount are required", "MISSING_PARAMS"));
      return;
    }
    const amount = Number(saleAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      next(new ValidationError("saleAmount must be a positive number", "INVALID_AMOUNT"));
      return;
    }

    const rules = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.tenantId, me.tenantId), eq(commissionRulesTable.isActive, true)));

    let travelScope = null;
    if (tripId) {
      const [trip] = await db.select({ destinationCountry: tripsTable.destinationCountry }).from(tripsTable)
        .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!trip) { next(new NotFoundError("Trip not found", "TRIP_NOT_FOUND")); return; }
      travelScope = getCommissionTravelScope(trip.destinationCountry);
    }

    const rule = selectApplicableCommissionRule(rules, tripId, travelScope);

    if (rule) {
      const calculation = calculateRuleCommission(amount, rule);
      res.json({
        ...calculation,
        source: "rule",
        saleAmount: amount,
      });
      return;
    }

    const [seller] = await db.select({
      commissionType: usersTable.commissionType,
      commissionRate: usersTable.commissionRate,
      commissionFixed: usersTable.commissionFixed,
    }).from(usersTable)
      .where(and(eq(usersTable.id, sellerId), eq(usersTable.tenantId, me.tenantId)))
      .limit(1);

    if (!seller) { next(new NotFoundError("Seller not found", "SELLER_NOT_FOUND")); return; }

    const calculation = calculateSellerCommission(amount, seller);
    res.json({
      ...calculation,
      source: calculation.commissionType === "percentage" && calculation.commissionAmount === 0 ? "none" : "seller",
      saleAmount: amount,
    });
  } catch (err) {
    req.log.error({ err }, "Error calculating commission");
    next(err);
  }
});

router.get("/commissions/my-rank", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    // Use Brazil calendar month (UTC-3) so rankings show the correct month at night
    const month = localToday().slice(0, 7); // "YYYY-MM" in America/Sao_Paulo

    const result = await db.execute(sql`
      SELECT
        user_id,
        COALESCE(SUM(commission_amount::numeric), 0) AS total_commission
      FROM commissions
      WHERE tenant_id = ${me.tenantId}
        AND status IN (${COMMISSION_STATUS.PENDING}, ${COMMISSION_STATUS.PAID}, ${COMMISSION_STATUS.APPROVED})
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${month}
      GROUP BY user_id
      ORDER BY total_commission DESC
    `);

    const rows = result.rows as Array<{ user_id: string; total_commission: string }>;
    const userIndex = rows.findIndex(r => r.user_id === me.id);
    const myRow = rows.find(r => r.user_id === me.id);

    res.json({
      rank: userIndex >= 0 ? userIndex + 1 : null,
      totalSellers: rows.length,
      monthlyCommission: myRow ? parseFloat(myRow.total_commission) : 0,
      month,
    });
  } catch (err) {
    req.log.error({ err }, "Error computing commission rank");
    next(err);
  }
});

const commissionSelect = {
  id: commissionsTable.id,
  tenantId: commissionsTable.tenantId,
  ruleId: commissionsTable.ruleId,
  userId: commissionsTable.userId,
  reservationId: commissionsTable.reservationId,
  baseAmount: commissionsTable.baseAmount,
  commissionAmount: commissionsTable.commissionAmount,
  commissionRate: commissionsTable.commissionRate,
  commissionType: commissionsTable.commissionType,
  status: commissionsTable.status,
  paidAt: commissionsTable.paidAt,
  createdAt: commissionsTable.createdAt,
  sellerName: usersTable.name,
};

router.get("/commissions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    let commissions;
    // Admins may see the tenant-wide commission ledger; other roles with
    // COMMISSIONS.VIEW remain restricted to their own commission rows.
    if (ADMIN_ROLES.includes(me.role)) {
      commissions = await db.select(commissionSelect).from(commissionsTable)
        .leftJoin(usersTable, eq(commissionsTable.userId, usersTable.id))
        .where(eq(commissionsTable.tenantId, me.tenantId))
        .orderBy(desc(commissionsTable.createdAt));
    } else {
      commissions = await db.select(commissionSelect).from(commissionsTable)
        .leftJoin(usersTable, eq(commissionsTable.userId, usersTable.id))
        .where(and(
          eq(commissionsTable.tenantId, me.tenantId),
          eq(commissionsTable.userId, me.id),
        ))
        .orderBy(desc(commissionsTable.createdAt));
    }
    res.json(commissions);
  } catch (err) {
    req.log.error({ err }, "Error listing commissions");
    next(err);
  }
});

router.patch("/commissions/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateCommissionBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    const [current] = await db.select().from(commissionsTable)
      .where(and(eq(commissionsTable.id, req.params.id), eq(commissionsTable.tenantId, me.tenantId))).limit(1);
    if (!current) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    if (current.status === parsed.data.status) {
      res.json(current);
      return;
    }
    if (!canTransitionCommissionStatus(current.status, parsed.data.status)) {
      next(new ConflictError("Commission status transition is not allowed", "COMMISSION_STATUS_TRANSITION"));
      return;
    }

    const paidAt = parsed.data.status === COMMISSION_STATUS.PAID
      ? new Date(parsed.data.paidAt ?? new Date().toISOString())
      : null;
    const [commission] = await db.update(commissionsTable).set({
      status: parsed.data.status,
      paidAt,
    }).where(and(
      eq(commissionsTable.id, req.params.id),
      eq(commissionsTable.tenantId, me.tenantId),
      eq(commissionsTable.status, current.status),
    )).returning();
    if (!commission) {
      next(new ConflictError("Commission was changed by another request", "COMMISSION_STATUS_TRANSITION"));
      return;
    }
    res.json(commission);
  } catch (err) {
    req.log.error({ err }, "Error updating commission");
    next(err);
  }
});

export default router;
