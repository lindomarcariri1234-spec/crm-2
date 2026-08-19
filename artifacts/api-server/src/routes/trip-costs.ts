import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { tripCostsTable, tripsTable, reservationsTable } from "@workspace/db";
import { eq, and, count, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';
import { EXPENSE_STATUS, RESERVATION_STATUS, hasPermission, RESOURCES, ACTIONS } from "@workspace/permissions";
import { z } from "zod/v4";

const router = Router();

const CATEGORY_VALUES = ["Transporte", "Hospedagem", "Alimentação", "Guia", "Marketing", "Seguro", "Taxas", "Outros"] as const;
const STATUS_VALUES = [EXPENSE_STATUS.PENDING, EXPENSE_STATUS.PAID, EXPENSE_STATUS.OVERDUE] as const;

// Accepts a finite number or a non-empty numeric string. Deliberately rejects
// `null`/`undefined`/empty/non-numeric — `z.coerce.number()` would coerce `null`
// (and `""`) to `0`, which previously was an explicit 400 on POST.
const AmountValue = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n), { message: "amount deve ser um número válido" });

const CreateTripCostBody = z.object({
  category: z.enum(CATEGORY_VALUES),
  description: z.string().min(1),
  supplierName: z.string().nullish(),
  amount: AmountValue,
  status: z.enum(STATUS_VALUES).optional(),
  dueDate: z.string().nullish(),
  paidAt: z.string().nullish(),
  notes: z.string().nullish(),
});

const UpdateTripCostBody = z.object({
  category: z.enum(CATEGORY_VALUES).optional(),
  description: z.string().min(1).optional(),
  supplierName: z.string().nullish(),
  amount: AmountValue.optional(),
  status: z.enum(STATUS_VALUES).optional(),
  dueDate: z.string().nullish(),
  paidAt: z.string().nullish(),
  notes: z.string().nullish(),
});

function formatCost(c: typeof tripCostsTable.$inferSelect) {
  return {
    id: c.id,
    tripId: c.tripId,
    category: c.category,
    description: c.description,
    supplierId: c.supplierId ?? null,
    supplierName: c.supplierName ?? null,
    amount: Number(c.amount),
    status: c.status,
    dueDate: c.dueDate?.toISOString() ?? null,
    paidAt: c.paidAt?.toISOString() ?? null,
    notes: c.notes ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/trips/:id/costs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "NOT_FOUND")); return; }

    const costs = await db.select()
      .from(tripCostsTable)
      .where(and(eq(tripCostsTable.tripId, req.params.id), eq(tripCostsTable.tenantId, me.tenantId)))
      .orderBy(tripCostsTable.createdAt);

    const [tripRow] = await db.select({
      priceAdult: tripsTable.priceAdult,
      fixedCosts: tripsTable.fixedCosts,
      variableCosts: tripsTable.variableCosts,
    }).from(tripsTable).where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);

    // Compute confirmedSeats dynamically from live reservations rather than relying
    // on the DB counter column, which may be 0 for trips created before the counter
    // was introduced. Counts only CONFIRMED reservations (REFUNDED ones have already
    // released their seats back; PENDING reservations are not yet confirmed revenue).
    const [confirmedSeatsRow] = await db
      .select({ total: count() })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, req.params.id),
        eq(reservationsTable.tenantId, me.tenantId),
        inArray(reservationsTable.status, [RESERVATION_STATUS.CONFIRMED]),
      ));

    const totalRealCosts = costs.reduce((s, c) => s + Number(c.amount), 0);
    const totalPaidCosts = costs.filter(c => c.status === EXPENSE_STATUS.PAID).reduce((s, c) => s + Number(c.amount), 0);
    const totalPendingCosts = costs.filter(c => c.status !== EXPENSE_STATUS.PAID).reduce((s, c) => s + Number(c.amount), 0);

    const priceAdult = Number(tripRow?.priceAdult ?? 0);
    const confirmedSeats = confirmedSeatsRow?.total ?? 0;
    const expectedRevenue2 = priceAdult * confirmedSeats;
    const profit = expectedRevenue2 - totalRealCosts;
    const margin = expectedRevenue2 > 0 ? (profit / expectedRevenue2) * 100 : 0;

    const fixedCosts = Array.isArray(tripRow?.fixedCosts) ? tripRow.fixedCosts as Array<{ id: string; category: string; description: string; value: number }> : [];
    const variableCosts = Array.isArray(tripRow?.variableCosts) ? tripRow.variableCosts as Array<{ id: string; category: string; description: string; valuePax: number }> : [];
    const plannedFixed = fixedCosts.reduce((s, c) => s + (c.value ?? 0), 0);
    const plannedVariable = variableCosts.reduce((s, c) => s + (c.valuePax ?? 0) * confirmedSeats, 0);
    const totalPlanned = plannedFixed + plannedVariable;

    res.json({
      costs: costs.map(formatCost),
      summary: {
        expectedRevenue: expectedRevenue2,
        totalRealCosts,
        totalPaidCosts,
        totalPendingCosts,
        profit,
        margin: Math.round(margin * 10) / 10,
        plannedBudget: totalPlanned,
        budgetVariance: totalRealCosts - totalPlanned,
        confirmedSeats,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/trips/:id/costs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.CREATE)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [trip] = await db.select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!trip) { next(new NotFoundError("Viagem não encontrada", "NOT_FOUND")); return; }

    const parsed = CreateTripCostBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { category, description, supplierName, amount, status, dueDate, paidAt, notes } = parsed.data;

    const id = generateId();
    await db.insert(tripCostsTable).values({
      id,
      tenantId: me.tenantId,
      tripId: req.params.id,
      category,
      description,
      supplierName: supplierName || null,
      amount: String(amount),
      status: status ?? EXPENSE_STATUS.PENDING,
      dueDate: dueDate ? new Date(dueDate) : null,
      paidAt: paidAt ? new Date(paidAt) : (status === EXPENSE_STATUS.PAID ? new Date() : null),
      notes: notes || null,
    });

    const [cost] = await db.select().from(tripCostsTable).where(and(eq(tripCostsTable.id, id), eq(tripCostsTable.tenantId, me.tenantId))).limit(1);
    res.status(201).json(formatCost(cost!));
  } catch (err) {
    next(err);
  }
});

router.put("/trips/:id/costs/:costId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [existing] = await db.select()
      .from(tripCostsTable)
      .where(and(
        eq(tripCostsTable.id, req.params.costId),
        eq(tripCostsTable.tripId, req.params.id),
        eq(tripCostsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Custo não encontrado", "NOT_FOUND")); return; }

    const parsed = UpdateTripCostBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const { category, description, supplierName, amount, status, dueDate, paidAt, notes } = parsed.data;
    const updates: Partial<typeof tripCostsTable.$inferInsert> = {};
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (supplierName !== undefined) updates.supplierName = supplierName || null;
    if (amount !== undefined) updates.amount = String(amount);
    if (status !== undefined) updates.status = status;
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
    if (paidAt !== undefined) updates.paidAt = paidAt ? new Date(paidAt) : null;
    else if (status === EXPENSE_STATUS.PAID && !existing.paidAt) updates.paidAt = new Date();
    if (notes !== undefined) updates.notes = notes || null;

    await db.update(tripCostsTable).set(updates)
      .where(and(eq(tripCostsTable.id, req.params.costId), eq(tripCostsTable.tenantId, me.tenantId)));

    const [cost] = await db.select().from(tripCostsTable).where(and(eq(tripCostsTable.id, req.params.costId), eq(tripCostsTable.tenantId, me.tenantId))).limit(1);
    res.json(formatCost(cost!));
  } catch (err) {
    next(err);
  }
});

router.delete("/trips/:id/costs/:costId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [existing] = await db.select({ id: tripCostsTable.id })
      .from(tripCostsTable)
      .where(and(
        eq(tripCostsTable.id, req.params.costId),
        eq(tripCostsTable.tripId, req.params.id),
        eq(tripCostsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Custo não encontrado", "NOT_FOUND")); return; }

    await db.delete(tripCostsTable)
      .where(and(eq(tripCostsTable.id, req.params.costId), eq(tripCostsTable.tenantId, me.tenantId)));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
