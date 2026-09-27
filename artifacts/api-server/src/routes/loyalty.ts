import { Router, type NextFunction } from "express";
import { db, loyaltyProgramsTable, loyaltyMembersTable, loyaltyTransactionsTable, clientsTable, paymentsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth, ADMIN_ROLES } from '../lib/tenant';
import { loyaltyAwardPoints, calculateTier, isTierUpgrade, sendLoyaltyTierUpgradeNotification } from "../lib/loyalty-helpers";
import { logger } from "../lib/logger";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES, PAYMENT_STATUS, PAYMENT_TYPE } from "@workspace/permissions";
import { roundMoney } from "../lib/pricing";

const router = Router();

const CreateProgramBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pointsPerReal: z.string().optional(),
  realPerPoint: z.string().optional(),
  minRedeemPoints: z.number().int().optional(),
  tierBenefits: z.record(z.string(), z.array(z.string())).nullable().optional(),
});

const CreateMemberBody = z.object({
  programId: z.string(),
  clientId: z.string(),
  tier: z.string().optional(),
});

const CreateTransactionBody = z.object({
  memberId: z.string(),
  programId: z.string(),
  type: z.enum(["earn", "redeem", "expire", "bonus"]),
  points: z.number().int().positive(),
  description: z.string().default(""),
  referenceId: z.string().optional(),
  referenceType: z.string().optional(),
});

router.get("/loyalty-programs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const programs = await db.select().from(loyaltyProgramsTable)
      .where(eq(loyaltyProgramsTable.tenantId, me.tenantId))
      .orderBy(desc(loyaltyProgramsTable.createdAt));
    res.json(programs);
  } catch (err) {
    next(err);
  }
});

router.post("/loyalty-programs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateProgramBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(loyaltyProgramsTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [prog] = await db.select().from(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.id, id)).limit(1);
    res.status(201).json(prog);
  } catch (err) {
    next(err);
  }
});

router.patch("/loyalty-programs/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateProgramBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    await db.update(loyaltyProgramsTable).set(parsed.data)
      .where(and(eq(loyaltyProgramsTable.id, req.params.id), eq(loyaltyProgramsTable.tenantId, me.tenantId)));
    const [prog] = await db.select().from(loyaltyProgramsTable)
      .where(and(eq(loyaltyProgramsTable.id, req.params.id), eq(loyaltyProgramsTable.tenantId, me.tenantId))).limit(1);
    if (!prog) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(prog);
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:clientId/loyalty", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { clientId } = req.params;

    if (me.role === ROLES.CLIENT) {
      const [ownClient] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);
      if (!ownClient || ownClient.id !== clientId) {
        next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
        return;
      }
    } else if (me.role === ROLES.SALES) {
      const [targetClient] = await db.select({ createdById: clientsTable.createdById })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.id, clientId)))
        .limit(1);
      if (!targetClient || targetClient.createdById !== me.id) {
        next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
        return;
      }
    }

    const [member] = await db.select().from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.tenantId, me.tenantId),
        eq(loyaltyMembersTable.clientId, clientId),
      )).limit(1);

    if (!member) {
      next(new NotFoundError("Client is not a loyalty member", "MEMBER_NOT_FOUND"));
      return;
    }

    const [program] = await db.select().from(loyaltyProgramsTable)
      .where(and(
        eq(loyaltyProgramsTable.id, member.programId),
        eq(loyaltyProgramsTable.tenantId, me.tenantId),
      )).limit(1);

    if (!program) {
      next(new NotFoundError("Loyalty program not found", "PROGRAM_NOT_FOUND"));
      return;
    }

    const availablePoints = member.availablePoints ?? 0;
    const realPerPoint = Number(program.realPerPoint ?? "0");
    const minRedeemPoints = program.minRedeemPoints ?? 1;
    const maxRedeemableAmount = roundMoney(availablePoints * realPerPoint);

    res.json({
      memberId: member.id,
      programId: program.id,
      programName: program.name,
      availablePoints,
      realPerPoint,
      minRedeemPoints,
      maxRedeemableAmount,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/loyalty-members", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const members = await db.select().from(loyaltyMembersTable)
      .where(eq(loyaltyMembersTable.tenantId, me.tenantId))
      .orderBy(desc(loyaltyMembersTable.joinedAt));
    res.json(members);
  } catch (err) {
    next(err);
  }
});

router.post("/loyalty-members", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateMemberBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [client] = await db.select({ id: clientsTable.id })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.id, parsed.data.clientId),
        eq(clientsTable.tenantId, me.tenantId),
      )).limit(1);
    const [program] = await db.select({ id: loyaltyProgramsTable.id })
      .from(loyaltyProgramsTable)
      .where(and(
        eq(loyaltyProgramsTable.id, parsed.data.programId),
        eq(loyaltyProgramsTable.tenantId, me.tenantId),
      )).limit(1);
    if (!client || !program) {
      next(new NotFoundError("Client or loyalty program not found", "NOT_FOUND"));
      return;
    }
    const id = generateId();
    await db.insert(loyaltyMembersTable).values({ id, tenantId: me.tenantId, ...parsed.data });
    const [member] = await db.select().from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.id, id),
        eq(loyaltyMembersTable.tenantId, me.tenantId),
      )).limit(1);
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

router.get("/loyalty-transactions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const transactions = await db.select().from(loyaltyTransactionsTable)
      .where(eq(loyaltyTransactionsTable.tenantId, me.tenantId))
      .orderBy(desc(loyaltyTransactionsTable.createdAt));
    res.json(transactions);
  } catch (err) {
    next(err);
  }
});

router.post("/loyalty-transactions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateTransactionBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const { tx, memberBefore, totalPoints, newTier } = await db.transaction(async (trx) => {
      // Lock the member while inserting and recomputing, preventing concurrent
      // transactions from overwriting each other's totals.
      const [member] = await trx
        .select()
        .from(loyaltyMembersTable)
        .where(and(
          eq(loyaltyMembersTable.id, parsed.data.memberId),
          eq(loyaltyMembersTable.tenantId, me.tenantId),
        ))
        .for("update")
        .limit(1);
      if (!member) throw new NotFoundError("Loyalty member not found", "MEMBER_NOT_FOUND");

      const [client] = await trx.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.id, member.clientId),
          eq(clientsTable.tenantId, me.tenantId),
        )).limit(1);
      const [program] = await trx.select({ id: loyaltyProgramsTable.id })
        .from(loyaltyProgramsTable)
        .where(and(
          eq(loyaltyProgramsTable.id, parsed.data.programId),
          eq(loyaltyProgramsTable.tenantId, me.tenantId),
        )).limit(1);
      if (!client || !program || member.programId !== program.id) {
        throw new NotFoundError("Loyalty member, client, or program not found", "NOT_FOUND");
      }

      const id = generateId();
      await trx.insert(loyaltyTransactionsTable).values({ id, tenantId: me.tenantId, ...parsed.data });
      const [createdTx] = await trx.select().from(loyaltyTransactionsTable)
        .where(and(
          eq(loyaltyTransactionsTable.id, id),
          eq(loyaltyTransactionsTable.tenantId, me.tenantId),
          eq(loyaltyTransactionsTable.memberId, parsed.data.memberId),
        )).limit(1);

      const allTx = await trx
        .select({ type: loyaltyTransactionsTable.type, points: loyaltyTransactionsTable.points })
        .from(loyaltyTransactionsTable)
        .where(and(
          eq(loyaltyTransactionsTable.tenantId, me.tenantId),
          eq(loyaltyTransactionsTable.memberId, parsed.data.memberId),
        ));
      const totalPoints = allTx
        .filter((t) => t.type === "earn" || t.type === "bonus")
        .reduce((s, t) => s + t.points, 0);
      const spentPoints = allTx
        .filter((t) => t.type === "redeem" || t.type === "expire")
        .reduce((s, t) => s + t.points, 0);
      const availablePoints = Math.max(0, totalPoints - spentPoints);
      const newTier = calculateTier(totalPoints);
      await trx
        .update(loyaltyMembersTable)
        .set({ totalPoints, availablePoints, tier: newTier, lastActivityAt: new Date() })
        .where(and(
          eq(loyaltyMembersTable.id, parsed.data.memberId),
          eq(loyaltyMembersTable.tenantId, me.tenantId),
        ));
      return { tx: createdTx, memberBefore: { tier: member.tier, clientId: member.clientId }, totalPoints, newTier };
    });

    // Notify the client if they moved up a tier (fire-and-forget).
    if (memberBefore && isTierUpgrade(memberBefore.tier, newTier)) {
      sendLoyaltyTierUpgradeNotification({
        clientId: memberBefore.clientId,
        tenantId: me.tenantId,
        newTier,
        totalPoints,
      }).catch((err) =>
        logger.warn({ err }, "[loyalty] tier-upgrade notification failed (manual tx)"),
      );
    }

    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
});

router.post("/loyalty/sync", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const members = await db
      .select()
      .from(loyaltyMembersTable)
      .where(eq(loyaltyMembersTable.tenantId, me.tenantId));

    if (members.length === 0) {
      res.json({ membersUpdated: 0, transactionsCreated: 0 });
      return;
    }

    const clientIds = members.map((m) => m.clientId);

    const paidPayments = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.status, PAYMENT_STATUS.PAID),
          eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
          inArray(paymentsTable.clientId, clientIds)
        )
      );

    let transactionsCreated = 0;
    const creditedMemberIds = new Set<string>();

    for (const payment of paidPayments) {
      if (!payment.clientId) continue;
      const result = await loyaltyAwardPoints({
        clientId: payment.clientId,
        paymentId: payment.id,
        amount: payment.amount,
        tenantId: me.tenantId,
      });
      if (result.credited) {
        transactionsCreated++;
        const member = members.find((m) => m.clientId === payment.clientId);
        if (member) creditedMemberIds.add(member.id);
      }
    }

    const updatedMemberIds = new Set<string>(creditedMemberIds);

    const freshMembers = await db
      .select()
      .from(loyaltyMembersTable)
      .where(eq(loyaltyMembersTable.tenantId, me.tenantId));

    for (const member of freshMembers) {
      const correctTier = calculateTier(member.totalPoints);
      if (member.tier !== correctTier) {
        await db
          .update(loyaltyMembersTable)
          .set({ tier: correctTier })
          .where(eq(loyaltyMembersTable.id, member.id));
        updatedMemberIds.add(member.id);
      }
    }

    res.json({ membersUpdated: updatedMemberIds.size, transactionsCreated });
  } catch (err) {
    next(err);
  }
});

export default router;
