import { Router, type NextFunction, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { tripCostsTable, tripsTable, reservationsTable, expensesTable, paymentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES } from '../lib/tenant';
import { EXPENSE_STATUS, PAYMENT_TYPE, RESERVATION_STATUS, hasPermission, RESOURCES, ACTIONS } from "@workspace/permissions";
import { z } from "zod/v4";
import { areExpenseAndTripCostLinkable } from "../services/expense-trip-cost-link";
import { calculateTripCostSummary } from "../services/trip-cost-summary";
import { operationalCostAmountsMatch, toPayableStatus } from "../services/operational-cost-payables";

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

type PlannedFixedCost = {
  id: string;
  category: string;
  description: string;
  value: number;
};

type PlannedVariableCost = {
  id: string;
  category: string;
  description: string;
  valuePax: number;
};

export function calculatePlannedCosts(
  fixedCosts: PlannedFixedCost[],
  variableCosts: PlannedVariableCost[],
  planningCapacity: number,
) {
  const plannedFixed = fixedCosts.reduce((sum, cost) => sum + Number(cost.value ?? 0), 0);
  const plannedVariable = variableCosts.reduce(
    (sum, cost) => sum + Number(cost.valuePax ?? 0) * planningCapacity,
    0,
  );

  return {
    plannedBudget: plannedFixed + plannedVariable,
    plannedCosts: [
      ...fixedCosts.map((cost) => ({
        id: cost.id,
        kind: "fixed" as const,
        category: cost.category,
        description: cost.description,
        amount: Number(cost.value ?? 0),
        amountPerPassenger: null,
      })),
      ...variableCosts.map((cost) => ({
        id: cost.id,
        kind: "variable" as const,
        category: cost.category,
        description: cost.description,
        amount: Number(cost.valuePax ?? 0) * planningCapacity,
        amountPerPassenger: Number(cost.valuePax ?? 0),
      })),
    ],
  };
}

function formatCost(
  c: typeof tripCostsTable.$inferSelect,
  linkedExpense: { id: string; description: string } | null = null,
) {
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
    linkedExpenseId: linkedExpense?.id ?? null,
    linkedExpenseDescription: linkedExpense?.description ?? null,
  };
}

function formatAgencyExpense(e: typeof expensesTable.$inferSelect) {
  return {
    id: e.id,
    tripId: e.tripId,
    category: e.category,
    description: e.description,
    amount: Number(e.amount),
    supplierId: e.supplierId ?? null,
    paymentMethod: e.paymentMethod ?? null,
    paymentDate: e.paymentDate?.toISOString() ?? null,
    dueDate: e.dueDate.toISOString(),
    status: e.status,
    notes: e.notes ?? null,
    createdAt: e.createdAt.toISOString(),
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
    const linkedExpenses = costs.length > 0
      ? await db.select({
        id: expensesTable.id,
        description: expensesTable.description,
        linkedTripCostId: expensesTable.linkedTripCostId,
      })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.tenantId, me.tenantId),
          inArray(expensesTable.linkedTripCostId, costs.map(cost => cost.id)),
        ))
      : [];
    const linkedExpenseByCostId = new Map(
      linkedExpenses.map(expense => [expense.linkedTripCostId!, expense]),
    );

    const agencyExpenses = await db.select()
      .from(expensesTable)
      .where(and(eq(expensesTable.tripId, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
      .orderBy(expensesTable.createdAt);

    const [tripRow] = await db.select({
      priceAdult: tripsTable.priceAdult,
      priceChild: tripsTable.priceChild,
      priceSenior: tripsTable.priceSenior,
      totalCapacity: tripsTable.totalCapacity,
      fixedCosts: tripsTable.fixedCosts,
      variableCosts: tripsTable.variableCosts,
    }).from(tripsTable).where(and(eq(tripsTable.id, req.params.id), eq(tripsTable.tenantId, me.tenantId))).limit(1);

    // Confirmed booking value comes from the reservation totals (already net of
    // discounts), not list adult fare × reservation row count. Capacity units are
    // authoritative for unnumbered vehicles; old numbered reservations fall back
    // to their persisted seat array, matching reservation-capacity.ts.
    const confirmedReservations = await db
      .select({
        totalValue: reservationsTable.totalValue,
        capacityUnits: reservationsTable.capacityUnits,
        seats: reservationsTable.seats,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, req.params.id),
        eq(reservationsTable.tenantId, me.tenantId),
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
      ));

    // A linked cost is represented by its expense in totals, matching the
    // canonical financial report. Keep the cost row in the response so clients
    // can still display the explicit relationship.
    const activeTripCosts = costs.filter(
      c => c.status !== "cancelled" && !linkedExpenseByCostId.has(c.id),
    );
    const totalTripCosts = activeTripCosts.reduce((s, c) => s + Number(c.amount), 0);
    const activeAgencyExpenses = agencyExpenses.filter(e => e.status !== "cancelled");
    const totalAgencyExpenses = activeAgencyExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const recordedCosts = [
      ...activeTripCosts.map(cost => ({ amount: cost.amount, status: cost.status })),
      ...activeAgencyExpenses.map(expense => ({ amount: expense.amount, status: expense.status })),
    ];

    const fixedCosts = Array.isArray(tripRow?.fixedCosts) ? tripRow.fixedCosts as PlannedFixedCost[] : [];
    const variableCosts = Array.isArray(tripRow?.variableCosts) ? tripRow.variableCosts as PlannedVariableCost[] : [];
    const summary = calculateTripCostSummary({
      confirmedReservations,
      costs: recordedCosts,
      fixedCostAmounts: fixedCosts.map(cost => cost.value ?? 0),
      variableCostPerPassengerAmounts: variableCosts.map(cost => cost.valuePax ?? 0),
    });

    // Match the reconciliation rows to the budget total: per-passenger items
    // are multiplied by confirmed capacity, not the trip's maximum capacity.
    const { plannedCosts } = calculatePlannedCosts(
      fixedCosts,
      variableCosts,
      summary.confirmedSeats,
    );
    const planningCapacity = tripRow?.totalCapacity ?? 0;
    const priceAdult = Number(tripRow?.priceAdult ?? 0);

    res.json({
      costs: costs.map(cost => formatCost(cost, linkedExpenseByCostId.get(cost.id) ?? null)),
      agencyExpenses: agencyExpenses.map(formatAgencyExpense),
      plannedCosts,
      pricing: {
        adult: priceAdult,
        child: tripRow?.priceChild == null ? null : Number(tripRow.priceChild),
        senior: tripRow?.priceSenior == null ? null : Number(tripRow.priceSenior),
      },
      summary: {
        ...summary,
        totalTripCosts,
        totalAgencyExpenses,
        planningCapacity,
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

const updateTripCost = async (
  req: Request<{ id: string; costId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const parsed = UpdateTripCostBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }
    const responseCost = await db.transaction(async (tx) => {
      const [payableSnapshot] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceTripCostId, req.params.costId),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      let linkedPayable: typeof paymentsTable.$inferSelect | null = null;
      if (payableSnapshot) {
        const [payment] = await tx.select().from(paymentsTable)
          .where(and(
            eq(paymentsTable.id, payableSnapshot.id),
            eq(paymentsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        linkedPayable = payment ?? null;
      }

      const [costSnapshot] = await tx.select({ id: tripCostsTable.id })
        .from(tripCostsTable)
        .where(and(
          eq(tripCostsTable.id, req.params.costId),
          eq(tripCostsTable.tripId, req.params.id),
          eq(tripCostsTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if (!costSnapshot) throw new NotFoundError("Custo não encontrado", "NOT_FOUND");

      // Always lock the linked expense before the trip cost, matching the lock
      // order used by expense updates and link/unlink operations.
      const [linkedExpenseSnapshot] = await tx.select({ id: expensesTable.id })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.linkedTripCostId, costSnapshot.id),
          eq(expensesTable.tenantId, me.tenantId),
        ))
        .limit(1);
      let lockedExpense: typeof expensesTable.$inferSelect | undefined;
      if (linkedExpenseSnapshot) {
        [lockedExpense] = await tx.select().from(expensesTable)
          .where(and(
            eq(expensesTable.id, linkedExpenseSnapshot.id),
            eq(expensesTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
      }

      const [existing] = await tx.select()
        .from(tripCostsTable)
        .where(and(
          eq(tripCostsTable.id, req.params.costId),
          eq(tripCostsTable.tripId, req.params.id),
          eq(tripCostsTable.tenantId, me.tenantId),
        ))
        .for("update").limit(1);
      if (!existing) throw new NotFoundError("Custo não encontrado", "NOT_FOUND");

      const [currentLinkedExpense] = await tx.select({ id: expensesTable.id })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.linkedTripCostId, existing.id),
          eq(expensesTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if ((lockedExpense?.id ?? null) !== (currentLinkedExpense?.id ?? null)) {
        throw new AppError("O vínculo mudou durante a edição. Tente novamente.", 409, "EXPENSE_LINK_CHANGED");
      }
      const [currentPayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceTripCostId, existing.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if ((payableSnapshot?.id ?? null) !== (currentPayable?.id ?? null)) {
        throw new AppError("O vínculo com a conta a pagar mudou. Tente novamente.", 409, "OPERATIONAL_COST_LINK_CHANGED");
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

      let payableStatus: ReturnType<typeof toPayableStatus> | undefined;
      if (linkedPayable) {
        if (lockedExpense) {
          throw new AppError(
            "Este custo é representado pela despesa da agência; gerencie a conta por essa despesa.",
            409,
            "OPERATIONAL_COST_SOURCE_LINKED",
          );
        }
        const sourceStatus = toPayableStatus(existing.status);
        if (
          !operationalCostAmountsMatch(existing.amount, linkedPayable.amount)
          || linkedPayable.status !== sourceStatus
        ) {
          throw new AppError("O custo e a conta a pagar divergiram.", 409, "OPERATIONAL_COST_PAYABLE_MISMATCH");
        }
        const nextStatus = toPayableStatus(updates.status ?? existing.status);
        if (updates.dueDate === null) {
          throw new AppError("Desvincule a conta a pagar antes de remover o vencimento.", 409, "OPERATIONAL_COST_DUE_DATE_REQUIRED");
        }
        if (nextStatus !== EXPENSE_STATUS.PAID) {
          if (updates.paidAt) {
            throw new AppError("Informe a data de pagamento somente para um custo pago.", 409, "OPERATIONAL_COST_PAID_AT_INVALID");
          }
          updates.paidAt = null;
        } else if (updates.paidAt === undefined) {
          updates.paidAt = existing.paidAt ?? linkedPayable.paidAt ?? new Date();
        }
        payableStatus = nextStatus;
      }

      if (lockedExpense && !areExpenseAndTripCostLinkable(lockedExpense, {
        tripId: existing.tripId,
        amount: updates.amount ?? existing.amount,
        status: updates.status ?? existing.status,
      })) {
        throw new AppError("Desvincule os registros antes de alterar valor ou status.", 409, "LINKED_EXPENSE_MISMATCH");
      }

      await tx.update(tripCostsTable).set(updates)
        .where(and(eq(tripCostsTable.id, existing.id), eq(tripCostsTable.tenantId, me.tenantId)));
      if (linkedPayable) {
        const dueDate = updates.dueDate !== undefined ? updates.dueDate : existing.dueDate ?? linkedPayable.dueDate;
        if (!dueDate) {
          throw new AppError("A conta a pagar vinculada precisa de um vencimento.", 409, "OPERATIONAL_COST_DUE_DATE_REQUIRED");
        }
        await tx.update(paymentsTable).set({
          category: updates.category ?? linkedPayable.category,
          description: updates.description ?? linkedPayable.description,
          notes: updates.notes !== undefined ? updates.notes : linkedPayable.notes,
          amount: updates.amount ?? existing.amount,
          dueDate,
          status: payableStatus!,
          paidAt: payableStatus === EXPENSE_STATUS.PAID ? updates.paidAt ?? existing.paidAt ?? linkedPayable.paidAt : null,
          updatedAt: new Date(),
        }).where(and(
          eq(paymentsTable.id, linkedPayable.id),
          eq(paymentsTable.tenantId, me.tenantId),
        ));
      }

      const [updatedCost] = await tx.select().from(tripCostsTable)
        .where(and(eq(tripCostsTable.id, existing.id), eq(tripCostsTable.tenantId, me.tenantId)))
        .limit(1);
      const [updatedExpense] = await tx.select({
        id: expensesTable.id,
        description: expensesTable.description,
      }).from(expensesTable)
        .where(and(
          eq(expensesTable.linkedTripCostId, existing.id),
          eq(expensesTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if (!updatedCost) throw new NotFoundError("Custo não encontrado", "NOT_FOUND");
      return formatCost(updatedCost, updatedExpense ?? null);
    });
    res.json(responseCost);
  } catch (err) {
    next(err);
  }
};

router.put("/trips/:id/costs/:costId", updateTripCost);
router.patch("/trips/:id/costs/:costId", updateTripCost);

router.delete("/trips/:id/costs/:costId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    await db.transaction(async (tx) => {
      const costFilter = and(
        eq(tripCostsTable.id, req.params.costId),
        eq(tripCostsTable.tripId, req.params.id),
        eq(tripCostsTable.tenantId, me.tenantId),
      );
      const [payableSnapshot] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceTripCostId, req.params.costId),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      let linkedPayable: typeof paymentsTable.$inferSelect | null = null;
      if (payableSnapshot) {
        const [payment] = await tx.select().from(paymentsTable)
          .where(and(
            eq(paymentsTable.id, payableSnapshot.id),
            eq(paymentsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        linkedPayable = payment ?? null;
      }
      const [costSnapshot] = await tx.select({ id: tripCostsTable.id })
        .from(tripCostsTable).where(costFilter).limit(1);
      if (!costSnapshot) throw new NotFoundError("Custo não encontrado", "NOT_FOUND");

      const [linkedExpenseSnapshot] = await tx.select({ id: expensesTable.id })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.linkedTripCostId, costSnapshot.id),
          eq(expensesTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if (linkedExpenseSnapshot) {
        await tx.select({ id: expensesTable.id }).from(expensesTable)
          .where(and(
            eq(expensesTable.id, linkedExpenseSnapshot.id),
            eq(expensesTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
      }

      const [existing] = await tx.select({ id: tripCostsTable.id })
        .from(tripCostsTable).where(costFilter).for("update").limit(1);
      if (!existing) throw new NotFoundError("Custo não encontrado", "NOT_FOUND");

      const [currentLinkedExpense] = await tx.select({ id: expensesTable.id })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.linkedTripCostId, existing.id),
          eq(expensesTable.tenantId, me.tenantId),
        ))
        .limit(1);
      if ((linkedExpenseSnapshot?.id ?? null) !== (currentLinkedExpense?.id ?? null)) {
        throw new AppError("O vínculo mudou durante a exclusão. Tente novamente.", 409, "EXPENSE_LINK_CHANGED");
      }
      const [currentPayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceTripCostId, existing.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if ((payableSnapshot?.id ?? null) !== (currentPayable?.id ?? null)) {
        throw new AppError("O vínculo com a conta a pagar mudou. Tente novamente.", 409, "OPERATIONAL_COST_LINK_CHANGED");
      }
      if (linkedPayable && currentPayable) {
        throw new AppError("Desvincule a conta a pagar antes de excluir o custo.", 409, "PAYMENT_LINKED_TO_OPERATIONAL_COST");
      }

      await tx.delete(tripCostsTable)
        .where(and(eq(tripCostsTable.id, req.params.costId), eq(tripCostsTable.tenantId, me.tenantId)));
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
