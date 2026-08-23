import { Router, type NextFunction } from "express";
import { db, clientsTable, financialLedgerEntriesTable, settlementItemsTable } from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { MANAGEMENT_ROLES, requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import {
  createClientBenefitEntry,
  expireClientBenefits,
  getClientBenefitBalances,
} from "../services/settlements/financial-ledger";

const router = Router();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function signedAmount(entry: { direction: string; amount: string | number }): number {
  const amount = Number(entry.amount);
  return entry.direction === "debit" ? -amount : amount;
}

router.get("/financial/settlement", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE"));
      return;
    }

    const dateFrom = typeof req.query["dateFrom"] === "string" ? req.query["dateFrom"] : undefined;
    const dateTo = typeof req.query["dateTo"] === "string" ? req.query["dateTo"] : undefined;
    if (dateFrom && !ISO_DATE.test(dateFrom)) {
      next(new ValidationError("dateFrom deve usar YYYY-MM-DD", "VALIDATION_ERROR"));
      return;
    }
    if (dateTo && !ISO_DATE.test(dateTo)) {
      next(new ValidationError("dateTo deve usar YYYY-MM-DD", "VALIDATION_ERROR"));
      return;
    }

    const conditions = [eq(financialLedgerEntriesTable.tenantId, me.tenantId)];
    if (dateFrom) conditions.push(gte(financialLedgerEntriesTable.occurredAt, new Date(`${dateFrom}T00:00:00-03:00`)));
    if (dateTo) conditions.push(lte(financialLedgerEntriesTable.occurredAt, new Date(`${dateTo}T23:59:59.999-03:00`)));
    const entries = await db.select().from(financialLedgerEntriesTable)
      .where(and(...conditions))
      .orderBy(desc(financialLedgerEntriesTable.occurredAt))
      .limit(300);
    const snapshots = await db.select().from(settlementItemsTable)
      .where(eq(settlementItemsTable.tenantId, me.tenantId))
      .orderBy(desc(settlementItemsTable.createdAt))
      .limit(300);

    const summary = entries.reduce((totals, entry) => {
      const value = signedAmount(entry);
      if (entry.participantType === "agency") totals.agencyNet += value;
      if (entry.participantType === "partner") totals.partnerPayable += value;
      if (entry.category === "wallet") totals.walletOutstanding += value;
      if (entry.category === "cashback") totals.cashbackOutstanding += value;
      if (entry.eventType === "order_refunded" || entry.eventType === "order_charged_back" || entry.eventType === "order_cancelled") totals.reversals += Math.abs(value);
      return totals;
    }, { agencyNet: 0, partnerPayable: 0, walletOutstanding: 0, cashbackOutstanding: 0, reversals: 0 });

    res.json({
      summary,
      entries: entries.map((entry) => ({
        ...entry,
        amount: Number(entry.amount),
        occurredAt: entry.occurredAt.toISOString(),
        expiresAt: entry.expiresAt?.toISOString() ?? null,
      })),
      items: snapshots.map((item) => ({
        ...item,
        grossAmount: Number(item.grossAmount),
        discountAmount: Number(item.discountAmount),
        taxAmount: Number(item.taxAmount),
        feeAmount: Number(item.feeAmount),
        commissionAmount: Number(item.commissionAmount),
        sellerNetAmount: Number(item.sellerNetAmount),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const BenefitBody = z.object({
  clientId: z.string().min(1),
  category: z.enum(["wallet", "cashback"]),
  operation: z.enum(["credit", "debit"]),
  amount: z.number().positive().max(1_000_000),
  description: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
  expiresAt: z.string().datetime().optional(),
  consentConfirmed: z.boolean().default(false),
});

/**
 * Staff-only benefit adjustment. It is intentionally explicit about both the
 * operation and consent; it never reuses referral or contractual commission
 * balances as wallet credit.
 */
router.post("/financial/benefits", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) {
      next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE"));
      return;
    }
    const parsed = BenefitBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR"));
      return;
    }
    if (parsed.data.operation === "credit" && !parsed.data.consentConfirmed) {
      next(new ValidationError("Confirme o consentimento do cliente antes de creditar o benefício", "BENEFIT_CONSENT_REQUIRED"));
      return;
    }

    await db.transaction(async (tx) => {
      const [client] = await tx.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!client) throw new NotFoundError("Cliente não encontrado", "NOT_FOUND");

      await expireClientBenefits(tx as never, { tenantId: me.tenantId, clientId: client.id });
      const balances = await getClientBenefitBalances(tx as never, { tenantId: me.tenantId, clientId: client.id });
      if (parsed.data.operation === "debit" && parsed.data.amount > balances[parsed.data.category]) {
        throw new ValidationError("Saldo de benefício insuficiente", "INSUFFICIENT_BENEFIT_BALANCE");
      }

      await createClientBenefitEntry(tx as never, {
        tenantId: me.tenantId,
        clientId: client.id,
        category: parsed.data.category,
        direction: parsed.data.operation,
        amount: parsed.data.amount,
        eventType: `manual_${parsed.data.category}_${parsed.data.operation}`,
        idempotencyKey: `manual-benefit:${parsed.data.idempotencyKey}`,
        description: parsed.data.description,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      });
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;