import { Router, type NextFunction } from "express";
import { db, commissionRulesTable, commissionsTable, usersTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { COMMISSION_STATUS } from "@workspace/permissions";
import { roundMoney } from "../lib/pricing";
import { localToday } from "@workspace/shared";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";

const router = Router();

const CreateRuleBody = z.object({
  name: z.string().min(1),
  type: z.enum(["percentage", "fixed"]).optional(),
  value: z.string(),
  appliesTo: z.string().optional(),
  tripId: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get("/commission-rules", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const rules = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.tenantId, me.tenantId), eq(commissionRulesTable.isActive, true)));
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
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateRuleBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(commissionRulesTable).values({ id, tenantId: me.tenantId, ...parsed.data });
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
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateRuleBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    await db.update(commissionRulesTable).set(parsed.data)
      .where(and(eq(commissionRulesTable.id, req.params.id), eq(commissionRulesTable.tenantId, me.tenantId)));
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
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
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

    const { sellerId, saleAmount, tripId } = req.query as Record<string, string>;
    if (!sellerId || !saleAmount) {
      next(new ValidationError("sellerId and saleAmount are required", "MISSING_PARAMS"));
      return;
    }
    const amount = parseFloat(saleAmount);
    if (isNaN(amount) || amount <= 0) {
      next(new ValidationError("saleAmount must be a positive number", "INVALID_AMOUNT"));
      return;
    }

    const rules = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.tenantId, me.tenantId), eq(commissionRulesTable.isActive, true)));

    const tripSpecificRule = tripId ? rules.find(r => r.appliesTo === "trip" && r.tripId === tripId) : undefined;
    const allRule = rules.find(r => r.appliesTo === "all");
    const rule = tripSpecificRule ?? allRule;

    if (rule) {
      const ruleValue = parseFloat(String(rule.value));
      const ruleType = rule.type ?? "percentage";
      const commissionAmount =
        ruleType === "fixed"
          ? roundMoney(ruleValue)
          : roundMoney(amount * ruleValue / 100);
      res.json({
        commissionAmount,
        commissionRate: ruleType === "fixed" ? null : ruleValue,
        commissionType: ruleType,
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

    const rate = parseFloat(String(seller.commissionRate ?? "0"));
    const fixed = parseFloat(String(seller.commissionFixed ?? "0"));

    if (seller.commissionType === "none") {
      res.json({ commissionAmount: 0, commissionRate: null, commissionType: "none", source: "seller", saleAmount: amount });
    } else if (seller.commissionType === "fixed" && fixed > 0) {
      res.json({ commissionAmount: fixed, commissionRate: null, commissionType: "fixed", source: "seller", saleAmount: amount });
    } else if (seller.commissionType === "hybrid") {
      const pct = rate > 0 ? roundMoney(amount * rate / 100) : 0;
      const commissionAmount = roundMoney(amount * rate / 100);
      res.json({ commissionAmount, commissionRate: rate, commissionType: "hybrid", source: "seller", saleAmount: amount });
    } else if (rate > 0) {
      const commissionAmount = roundMoney(amount * rate / 100);
      res.json({ commissionAmount, commissionRate: rate, commissionType: "percentage", source: "seller", saleAmount: amount });
    } else {
      res.json({ commissionAmount: 0, commissionRate: 0, commissionType: "percentage", source: "none", saleAmount: amount });
    }
  } catch (err) {
    req.log.error({ err }, "Error calculating commission");
    next(err);
  }
});

router.get("/commissions/my-rank", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

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

    let commissions;
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
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({ status: z.string().optional(), paidAt: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(parsed.error.message, "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = {};
    if (parsed.data.status) updates.status = parsed.data.status;
    if (parsed.data.paidAt) updates.paidAt = new Date(parsed.data.paidAt);
    await db.update(commissionsTable).set(updates)
      .where(and(eq(commissionsTable.id, req.params.id), eq(commissionsTable.tenantId, me.tenantId)));
    const [commission] = await db.select().from(commissionsTable)
      .where(and(eq(commissionsTable.id, req.params.id), eq(commissionsTable.tenantId, me.tenantId))).limit(1);
    if (!commission) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(commission);
  } catch (err) {
    req.log.error({ err }, "Error updating commission");
    next(err);
  }
});

export default router;
