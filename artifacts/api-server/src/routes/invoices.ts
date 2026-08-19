import { Router, type NextFunction } from "express";
import { db, invoicesTable, tenantsTable, plansTable, subscriptionsTable, tripsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES, INVOICE_STATUS, INVOICE_STATUS_VALUES, TENANT_STATUS, SUBSCRIPTION_STATUS, type InvoiceStatus } from "@workspace/permissions";
import { hasSeatMapFeature } from "../lib/plan-features";

async function activateInvoicePlan(invoiceId: string, tenantId: string): Promise<void> {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId)).limit(1);
  if (!invoice || invoice.status === INVOICE_STATUS.PAID) return;

  await db.update(invoicesTable).set({ status: INVOICE_STATUS.PAID, paidAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId));

  if (invoice.planId) {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, invoice.planId)).limit(1);
    if (plan) {
      await db.update(tenantsTable).set({ planId: plan.slug, pendingPlanId: null, status: TENANT_STATUS.ACTIVE, updatedAt: new Date() })
        .where(eq(tenantsTable.id, tenantId));

      if (!hasSeatMapFeature((plan.supportedFeatures ?? []) as string[])) {
        await db.update(tripsTable).set({ showSeatMap: true }).where(eq(tripsTable.tenantId, tenantId));
      }

      const [existingSub] = await db.select().from(subscriptionsTable)
        .where(eq(subscriptionsTable.tenantId, tenantId))
        .orderBy(desc(subscriptionsTable.createdAt))
        .limit(1);

      const periodEnd = invoice.billingPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      if (existingSub) {
        await db.update(subscriptionsTable)
          .set({ planId: plan.id, status: SUBSCRIPTION_STATUS.ACTIVE, currentPeriodEnd: periodEnd })
          .where(eq(subscriptionsTable.id, existingSub.id));
      } else {
        await db.insert(subscriptionsTable).values({
          id: generateId(), tenantId, planId: plan.id, status: SUBSCRIPTION_STATUS.ACTIVE,
          billingCycle: "monthly", currentPeriodStart: new Date(), currentPeriodEnd: periodEnd,
        });
      }
    }
  }
}

const router = Router();

const InvoiceBody = z.object({
  tenantId: z.string().min(1),
  planId: z.string().optional(),
  amount: z.string(),
  currency: z.string().optional(),
  status: z.enum(INVOICE_STATUS_VALUES).optional(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateInvoiceBody = z.object({
  status: z.enum(INVOICE_STATUS_VALUES).optional(),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
  amount: z.string().optional(),
  dueDate: z.string().optional(),
});

router.get("/admin/invoices", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    let query = db.select({
      id: invoicesTable.id,
      tenantId: invoicesTable.tenantId,
      planId: invoicesTable.planId,
      invoiceNumber: invoicesTable.invoiceNumber,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paymentMethod: invoicesTable.paymentMethod,
      dueDate: invoicesTable.dueDate,
      paidAt: invoicesTable.paidAt,
      description: invoicesTable.description,
      notes: invoicesTable.notes,
      pixCode: invoicesTable.pixCode,
      pixQrCodeUrl: invoicesTable.pixQrCodeUrl,
      pixExpiresAt: invoicesTable.pixExpiresAt,
      createdAt: invoicesTable.createdAt,
      updatedAt: invoicesTable.updatedAt,
      tenantName: tenantsTable.name,
      tenantEmail: tenantsTable.email,
    })
      .from(invoicesTable)
      .leftJoin(tenantsTable, eq(invoicesTable.tenantId, tenantsTable.id))
      .orderBy(desc(invoicesTable.createdAt))
      .$dynamic();

    const conditions = [];
    if (req.query.tenantId) {
      conditions.push(eq(invoicesTable.tenantId, req.query.tenantId as string));
    }
    if (req.query.status) {
      if (!(INVOICE_STATUS_VALUES as readonly string[]).includes(req.query.status as string)) {
        next(new ValidationError(String(`Invalid status. Must be one of: ${INVOICE_STATUS_VALUES.join(", ")}`), "VALIDATION_ERROR"));
        return;
      }
      conditions.push(eq(invoicesTable.status, req.query.status as string as InvoiceStatus));
    }
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const invoices = await query;
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

router.post("/admin/invoices", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = InvoiceBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(invoicesTable).values({
      id,
      tenantId: parsed.data.tenantId,
      planId: parsed.data.planId,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      status: parsed.data.status,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
      description: parsed.data.description,
      notes: parsed.data.notes,
    });
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

router.patch("/admin/invoices/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.SUPER_ADMIN) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateInvoiceBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const update: {
      status?: import("@workspace/permissions").InvoiceStatus;
      paidAt?: Date;
      notes?: string;
      amount?: string;
      dueDate?: Date;
    } = {};

    if (parsed.data.status) update.status = parsed.data.status;
    if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
    if (parsed.data.amount) update.amount = parsed.data.amount;
    if (parsed.data.paidAt) update.paidAt = new Date(parsed.data.paidAt);
    if (parsed.data.dueDate) update.dueDate = new Date(parsed.data.dueDate);
    if (parsed.data.status === INVOICE_STATUS.PAID && !parsed.data.paidAt) {
      update.paidAt = new Date();
    }

    if (parsed.data.status === INVOICE_STATUS.PAID) {
      const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
      if (inv && inv.tenantId) {
        await activateInvoicePlan(req.params.id, inv.tenantId);
      } else {
        await db.update(invoicesTable).set(update).where(eq(invoicesTable.id, req.params.id));
      }
    } else {
      await db.update(invoicesTable).set(update).where(eq(invoicesTable.id, req.params.id));
    }

    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, req.params.id)).limit(1);
    if (!invoice) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

export default router;
