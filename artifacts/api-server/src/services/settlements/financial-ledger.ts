import {
  financialLedgerEntriesTable,
  settlementItemsTable,
} from "@workspace/db";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { DbExecutor } from "../../lib/reservation-payments";
import { generateId } from "../../lib/id";

export type LedgerDirection = "credit" | "debit";
export type BenefitCategory = "wallet" | "cashback";

function oppositeDirection(direction: string): LedgerDirection {
  return direction === "credit" ? "debit" : "credit";
}

function signedAmount(entry: { direction: string; amount: string | number }): number {
  const amount = Number(entry.amount);
  return entry.direction === "debit" ? -amount : amount;
}

type BenefitLot = { id: string; remaining: number; expiresAt: Date | null };

function benefitLots(entries: Array<{ id: string; category: string; direction: string; amount: string | number; expiresAt: Date | null; metadata: Record<string, unknown> | null }>, category: BenefitCategory): BenefitLot[] {
  const lots = entries
    .filter((entry) => entry.category === category && entry.direction === "credit")
    .map((entry) => ({ id: entry.id, remaining: Number(entry.amount), expiresAt: entry.expiresAt }))
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  for (const debit of entries.filter((entry) => entry.category === category && entry.direction === "debit")) {
    const allocations = debit.metadata?.["allocations"];
    if (Array.isArray(allocations)) {
      for (const allocation of allocations) {
        if (!allocation || typeof allocation !== "object") continue;
        const row = allocation as { creditId?: unknown; amount?: unknown };
        const lot = typeof row.creditId === "string" ? byId.get(row.creditId) : undefined;
        if (lot) lot.remaining -= Number(row.amount ?? 0);
      }
    } else {
      let remaining = Number(debit.amount);
      for (const lot of lots) { const used = Math.min(lot.remaining, remaining); lot.remaining -= used; remaining -= used; if (remaining <= 0) break; }
    }
  }
  return lots;
}

/**
 * Creates the participant claims for a paid store order. The unique
 * idempotency key on every generated entry makes repeated gateway deliveries
 * harmless and keeps the ledger append-only.
 */
export async function recordOrderPaymentSettlement(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    gateway: string;
    transactionId: string;
    occurredAt: Date;
    receivedAmount?: number;
  },
): Promise<void> {
  const snapshots = await tx
    .select()
    .from(settlementItemsTable)
    .where(and(
      eq(settlementItemsTable.tenantId, args.tenantId),
      eq(settlementItemsTable.orderId, args.orderId),
    ))
    .orderBy(asc(settlementItemsTable.createdAt));

  const eventKey = `order-payment:${args.gateway}:${args.transactionId}`;
  const grossTotal = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.grossAmount), 0);
  const claims: Array<{
    snapshot: typeof snapshots[number];
    participantType: string;
    participantId: string | null;
    category: string;
    baseAmount: number;
  }> = [];
  for (const snapshot of snapshots) {
    const metadata = {
      orderId: args.orderId,
      settlementItemId: snapshot.id,
      source: snapshot.source,
      gateway: args.gateway,
      transactionId: args.transactionId,
    };
    const entries: Array<{
      participantType: string;
      participantId: string | null;
      category: string;
      amount: string | number;
    }> = snapshot.sellerType === "partner" && snapshot.sellerId
      ? [
          {
            participantType: "agency",
            participantId: args.tenantId,
            category: "agency_commission",
            amount: snapshot.commissionAmount,
          },
          {
            participantType: "partner",
            participantId: snapshot.sellerId,
            category: "partner_payout",
            amount: snapshot.sellerNetAmount,
          },
        ]
      : [{
          participantType: "agency",
          participantId: args.tenantId,
          category: "agency_sale",
          amount: snapshot.sellerNetAmount,
        }];

    for (const entry of entries) {
      claims.push({ snapshot, ...entry, baseAmount: Number(entry.amount) });
    }
  }

  const targetCents = Math.max(0, Math.min(
    Math.round((args.receivedAmount ?? grossTotal) * 100),
    Math.round(grossTotal * 100),
  ));
  const baseCents = claims.reduce((sum, claim) => sum + Math.round(claim.baseAmount * 100), 0);
  let allocatedCents = 0;
  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index]!;
    const isLast = index === claims.length - 1;
    const settledCents = isLast
      ? targetCents - allocatedCents
      : Math.floor(targetCents * Math.round(claim.baseAmount * 100) / Math.max(baseCents, 1));
    allocatedCents += settledCents;
    const settledAmount = settledCents / 100;
      if (settledAmount <= 0) continue;
      await tx.insert(financialLedgerEntriesTable).values({
        id: generateId(),
        tenantId: args.tenantId,
        settlementItemId: claim.snapshot.id,
        orderId: args.orderId,
        participantType: claim.participantType,
        participantId: claim.participantId,
        category: claim.category,
        direction: "credit",
        amount: settledAmount.toFixed(2),
        settlementStatus: "available",
        eventType: "order_payment",
        idempotencyKey: `${eventKey}:${claim.snapshot.id}:${claim.category}`,
        metadata: {
          orderId: args.orderId,
          settlementItemId: claim.snapshot.id,
          source: claim.snapshot.source,
          gateway: args.gateway,
          transactionId: args.transactionId,
        },
        occurredAt: args.occurredAt,
        availableAt: args.occurredAt,
      }).onConflictDoNothing();
  }

  await tx.update(settlementItemsTable)
    .set({ settlementStatus: "available" })
    .where(and(
      eq(settlementItemsTable.tenantId, args.tenantId),
      eq(settlementItemsTable.orderId, args.orderId),
    ));
}

export async function reverseOrderPaymentSettlementEvent(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    gateway: string;
    transactionId: string;
    amount: number;
    eventKey: string;
    occurredAt: Date;
    reason: string;
  },
): Promise<void> {
  const entries = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.orderId, args.orderId),
  ));
  const originals = entries.filter((entry) =>
    entry.eventType === "order_payment"
    && entry.reversalOfEntryId == null
    && entry.metadata?.["gateway"] === args.gateway
    && entry.metadata?.["transactionId"] === args.transactionId,
  );
  const balances = originals.map((entry) => {
    const reversedCents = entries
      .filter((candidate) =>
        isSettlementReversalEntry(candidate)
        && (
        candidate.reversalOfEntryId === entry.id
          || candidate.metadata?.["originalEntryId"] === entry.id
        )
      )
      .reduce((sum, candidate) => sum + Math.round(Number(candidate.amount) * 100), 0);
    const reinstatedCents = entries
      .filter((candidate) =>
        candidate.eventType === "order_payment_reinstatement"
        && candidate.metadata?.["originalEntryId"] === entry.id,
      )
      .reduce((sum, candidate) => sum + Math.round(Number(candidate.amount) * 100), 0);
    return {
      entry,
      remainingCents: Math.max(0, Math.round(Number(entry.amount) * 100) + reinstatedCents - reversedCents),
    };
  }).filter(({ remainingCents }) => remainingCents > 0);
  const remainingTotalCents = balances.reduce((sum, balance) => sum + balance.remainingCents, 0);
  const targetCents = Math.min(Math.round(args.amount * 100), remainingTotalCents);
  let allocatedCents = 0;
  for (let index = 0; index < balances.length; index++) {
    const { entry, remainingCents } = balances[index]!;
    const isLast = index === balances.length - 1;
    const targetEntryCents = isLast
      ? targetCents - allocatedCents
      : Math.floor(targetCents * remainingCents / Math.max(remainingTotalCents, 1));
    allocatedCents += targetEntryCents;
    const reversalAmount = targetEntryCents / 100;
    if (reversalAmount <= 0) continue;
    await tx.insert(financialLedgerEntriesTable).values({
      id: generateId(),
      tenantId: args.tenantId,
      settlementItemId: entry.settlementItemId,
      orderId: args.orderId,
      clientId: entry.clientId,
      participantType: entry.participantType,
      participantId: entry.participantId,
      category: "settlement_reversal",
      direction: oppositeDirection(entry.direction),
      amount: reversalAmount.toFixed(2),
      currency: entry.currency,
      settlementStatus: "reversed",
      eventType: "order_refund_adjustment",
      idempotencyKey: `${args.eventKey}:${entry.id}`,
      reversalOfEntryId: entry.id,
      metadata: { reason: args.reason, originalCategory: entry.category, originalEntryId: entry.id },
      occurredAt: args.occurredAt,
    }).onConflictDoNothing();
  }
}

/**
 * Reinstates the claims previously reversed for a payment that is moved back
 * to paid. Reinstatement is a new ledger event because the original
 * idempotency key must remain immutable.
 */
export async function reinstateOrderPaymentSettlementEvent(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    gateway: string;
    transactionId: string;
    amount: number;
    eventKey: string;
    occurredAt: Date;
  },
): Promise<number> {
  const entries = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.orderId, args.orderId),
  ));
  const originals = entries.filter((entry) =>
    entry.eventType === "order_payment"
    && entry.reversalOfEntryId == null
    && entry.metadata?.["gateway"] === args.gateway
    && entry.metadata?.["transactionId"] === args.transactionId,
  );
  const balances = originals.map((entry) => {
    const reversedCents = entries
      .filter((candidate) =>
        isSettlementReversalEntry(candidate)
        && (
          candidate.reversalOfEntryId === entry.id
          || candidate.metadata?.["originalEntryId"] === entry.id
        ),
      )
      .reduce((sum, candidate) => sum + Math.round(Number(candidate.amount) * 100), 0);
    const reinstatedCents = entries
      .filter((candidate) =>
        candidate.eventType === "order_payment_reinstatement"
        && candidate.metadata?.["originalEntryId"] === entry.id,
      )
      .reduce((sum, candidate) => sum + Math.round(Number(candidate.amount) * 100), 0);
    return {
      entry,
      remainingCents: Math.max(0, reversedCents - reinstatedCents),
    };
  }).filter(({ remainingCents }) => remainingCents > 0);
  const availableCents = balances.reduce((sum, balance) => sum + balance.remainingCents, 0);
  const targetCents = Math.min(Math.round(args.amount * 100), availableCents);
  let allocatedCents = 0;
  for (let index = 0; index < balances.length; index++) {
    const { entry, remainingCents } = balances[index]!;
    const reinstatedCents = index === balances.length - 1
      ? targetCents - allocatedCents
      : Math.floor(targetCents * remainingCents / Math.max(availableCents, 1));
    allocatedCents += reinstatedCents;
    if (reinstatedCents <= 0) continue;
    await tx.insert(financialLedgerEntriesTable).values({
      id: generateId(),
      tenantId: args.tenantId,
      settlementItemId: entry.settlementItemId,
      orderId: args.orderId,
      clientId: entry.clientId,
      participantType: entry.participantType,
      participantId: entry.participantId,
      category: entry.category,
      direction: "credit",
      amount: (reinstatedCents / 100).toFixed(2),
      currency: entry.currency,
      settlementStatus: "available",
      eventType: "order_payment_reinstatement",
      idempotencyKey: `${args.eventKey}:${entry.id}`,
      metadata: { originalEntryId: entry.id, gateway: args.gateway, transactionId: args.transactionId },
      occurredAt: args.occurredAt,
      availableAt: args.occurredAt,
    }).onConflictDoNothing();
  }
  return targetCents;
}

function isSettlementReversalEntry(entry: { eventType?: string | null }): boolean {
  return entry.eventType === "order_refund_adjustment"
    || entry.eventType === "order_refunded"
    || entry.eventType === "order_charged_back"
    || entry.eventType === "order_cancelled";
}

/**
 * Compensates all order-payment participant claims after a refund or dispute.
 * The original financial facts remain untouched; the net balance is changed by
 * new opposite-direction entries linked back to their source entry.
 */
export async function reverseOrderSettlement(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    eventType: "order_refunded" | "order_charged_back" | "order_cancelled";
    eventKey: string;
    occurredAt: Date;
    reason: string;
  },
): Promise<void> {
  const entries = await tx
    .select()
    .from(financialLedgerEntriesTable)
    .where(and(
      eq(financialLedgerEntriesTable.tenantId, args.tenantId),
      eq(financialLedgerEntriesTable.orderId, args.orderId),
      eq(financialLedgerEntriesTable.eventType, "order_payment"),
      isNull(financialLedgerEntriesTable.reversalOfEntryId),
    ));
  const reversals = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.orderId, args.orderId),
  ));

  for (const entry of entries) {
    const alreadyAdjusted = reversals
      .filter((adjustment) =>
        isSettlementReversalEntry(adjustment)
        && (
        adjustment.reversalOfEntryId === entry.id
        || adjustment.metadata?.["originalEntryId"] === entry.id
        )
      )
      .reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
    const reinstated = reversals
      .filter((adjustment) =>
        adjustment.eventType === "order_payment_reinstatement"
        && adjustment.metadata?.["originalEntryId"] === entry.id,
      )
      .reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
    const remaining = Number((Number(entry.amount) + reinstated - alreadyAdjusted).toFixed(2));
    if (remaining <= 0) continue;
    await tx.insert(financialLedgerEntriesTable).values({
      id: generateId(),
      tenantId: args.tenantId,
      settlementItemId: entry.settlementItemId,
      orderId: args.orderId,
      clientId: entry.clientId,
      participantType: entry.participantType,
      participantId: entry.participantId,
      category: "settlement_reversal",
      direction: oppositeDirection(entry.direction),
      amount: remaining.toFixed(2),
      currency: entry.currency,
      settlementStatus: "reversed",
      eventType: args.eventType,
      idempotencyKey: `${args.eventKey}:${entry.id}`,
      reversalOfEntryId: entry.id,
      metadata: { reason: args.reason, originalCategory: entry.category },
      occurredAt: args.occurredAt,
    }).onConflictDoNothing();
  }

  await tx.update(settlementItemsTable)
    .set({ settlementStatus: "reversed" })
    .where(and(
      eq(settlementItemsTable.tenantId, args.tenantId),
      eq(settlementItemsTable.orderId, args.orderId),
    ));
}

export async function adjustOrderSettlement(
  tx: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    amount: number;
    totalAmount: number;
    eventKey: string;
    occurredAt: Date;
    reason: string;
  },
): Promise<void> {
  if (args.amount <= 0 || args.totalAmount <= 0) return;
  const originals = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.orderId, args.orderId),
    eq(financialLedgerEntriesTable.eventType, "order_payment"),
  ));
  const priorAdjustments = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.orderId, args.orderId),
    eq(financialLedgerEntriesTable.eventType, "order_refund_adjustment"),
  ));
  const ratio = Math.min(args.amount / args.totalAmount, 1);
  for (const entry of originals) {
    const target = Number((Number(entry.amount) * ratio).toFixed(2));
    const alreadyAdjusted = priorAdjustments
      .filter((adjustment) => adjustment.metadata?.["originalEntryId"] === entry.id)
      .reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
    const adjustment = Number((target - alreadyAdjusted).toFixed(2));
    if (adjustment <= 0) continue;
    await tx.insert(financialLedgerEntriesTable).values({
      id: generateId(), tenantId: args.tenantId, settlementItemId: entry.settlementItemId,
      orderId: args.orderId, clientId: entry.clientId, participantType: entry.participantType,
      participantId: entry.participantId, category: "settlement_adjustment", direction: "debit",
      amount: adjustment.toFixed(2), currency: entry.currency, settlementStatus: "reversed",
      eventType: "order_refund_adjustment", idempotencyKey: `${args.eventKey}:${entry.id}`,
      metadata: { reason: args.reason, originalCategory: entry.category, originalEntryId: entry.id, refundRatio: ratio },
      occurredAt: args.occurredAt,
    }).onConflictDoNothing();
  }
}

export async function expireClientBenefits(
  tx: DbExecutor,
  args: { tenantId: string; clientId: string; occurredAt?: Date },
): Promise<void> {
  const occurredAt = args.occurredAt ?? new Date();
  const entries = await tx.select().from(financialLedgerEntriesTable).where(and(
    eq(financialLedgerEntriesTable.tenantId, args.tenantId),
    eq(financialLedgerEntriesTable.clientId, args.clientId),
  ));
  const alreadyExpired = new Set(entries.map((entry) => entry.reversalOfEntryId).filter(Boolean));
  for (const category of ["wallet", "cashback"] as const) {
    for (const lot of benefitLots(entries, category).filter((lot) => lot.expiresAt && lot.expiresAt < occurredAt && !alreadyExpired.has(lot.id))) {
      const amount = Math.max(lot.remaining, 0);
    if (amount <= 0) continue;
    await tx.insert(financialLedgerEntriesTable).values({
      id: generateId(),
      tenantId: args.tenantId,
      clientId: args.clientId,
      participantType: "client",
      participantId: args.clientId,
      category,
      direction: "debit",
      amount: amount.toFixed(2),
      currency: "BRL",
      settlementStatus: "expired",
      eventType: "benefit_expired",
      idempotencyKey: `benefit-expiry:${lot.id}`,
      reversalOfEntryId: lot.id,
      metadata: { expiredEntryId: lot.id, allocations: [{ creditId: lot.id, amount }] },
      occurredAt,
    }).onConflictDoNothing();
    }
  }
}

export async function getClientBenefitBalances(
  tx: DbExecutor,
  args: { tenantId: string; clientId: string },
): Promise<{ wallet: number; cashback: number }> {
  const entries = await tx
    .select({
      category: financialLedgerEntriesTable.category,
      direction: financialLedgerEntriesTable.direction,
      amount: financialLedgerEntriesTable.amount,
    })
    .from(financialLedgerEntriesTable)
    .where(and(
      eq(financialLedgerEntriesTable.tenantId, args.tenantId),
      eq(financialLedgerEntriesTable.clientId, args.clientId),
    ));

  return entries.reduce((totals, entry) => {
    if (entry.category === "wallet" || entry.category === "cashback") {
      totals[entry.category] += signedAmount(entry);
    }
    return totals;
  }, { wallet: 0, cashback: 0 });
}

export async function createClientBenefitEntry(
  tx: DbExecutor,
  args: {
    tenantId: string;
    clientId: string;
    category: BenefitCategory;
    direction: LedgerDirection;
    amount: number;
    eventType: string;
    idempotencyKey: string;
    description: string;
    occurredAt?: Date;
    expiresAt?: Date | null;
    orderId?: string | null;
  },
): Promise<void> {
  const occurredAt = args.occurredAt ?? new Date();
  let allocations: Array<{ creditId: string; amount: number }> = [];
  if (args.direction === "debit") {
    const entries = await tx.select().from(financialLedgerEntriesTable).where(and(
      eq(financialLedgerEntriesTable.tenantId, args.tenantId),
      eq(financialLedgerEntriesTable.clientId, args.clientId),
    ));
    let remaining = args.amount;
    for (const lot of benefitLots(entries, args.category)
      .filter((lot) => !lot.expiresAt || lot.expiresAt > occurredAt)) {
      const used = Math.min(Math.max(lot.remaining, 0), remaining);
      if (used > 0) allocations.push({ creditId: lot.id, amount: used });
      remaining -= used;
      if (remaining <= 0) break;
    }
  }
  await tx.insert(financialLedgerEntriesTable).values({
    id: generateId(),
    tenantId: args.tenantId,
    orderId: args.orderId ?? null,
    clientId: args.clientId,
    participantType: "client",
    participantId: args.clientId,
    category: args.category,
    direction: args.direction,
    amount: args.amount.toFixed(2),
    settlementStatus: args.direction === "credit" ? "available" : "consumed",
    eventType: args.eventType,
    idempotencyKey: args.idempotencyKey,
    expiresAt: args.expiresAt ?? null,
    metadata: { description: args.description, allocations },
    occurredAt,
    availableAt: occurredAt,
  }).onConflictDoNothing();
}