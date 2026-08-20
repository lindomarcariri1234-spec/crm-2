import { db, loyaltyProgramsTable, loyaltyMembersTable, loyaltyTransactionsTable, clientsTable, tenantsTable, systemConfigsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "./id";
import { logger } from "./logger";
import { insertClientNotification } from "./client-notifications";
import { sendLoyaltyTierUpgradeEmail } from "@workspace/email";
import { enqueueOrSend } from "../queues/whatsapp-helpers";

export function calculateTier(totalPoints: number): string {
  if (totalPoints >= 5000) return "diamond";
  if (totalPoints >= 1500) return "gold";
  if (totalPoints >= 500) return "silver";
  return "bronze";
}

const TIER_RANK: Record<string, number> = { bronze: 0, silver: 1, gold: 2, diamond: 3 };
const TIER_LABELS_PT: Record<string, string> = {
  bronze: "Bronze", silver: "Prata", gold: "Ouro", diamond: "Diamante",
};
const TIER_NEXT_LABEL: Record<string, string | null> = {
  bronze: "Prata", silver: "Ouro", gold: "Diamante", diamond: null,
};
const TIER_NEXT_MIN: Record<string, number | null> = {
  bronze: 500, silver: 1500, gold: 5000, diamond: null,
};

/** Returns true only when the tier went UP (e.g. bronze → silver). */
export function isTierUpgrade(oldTier: string, newTier: string): boolean {
  return (TIER_RANK[newTier] ?? 0) > (TIER_RANK[oldTier] ?? 0);
}

/**
 * Fires a WhatsApp message and in-app notification when a client moves up a
 * loyalty tier. Must be called fire-and-forget (.catch()) so it never blocks
 * the points-award response.
 */
export async function sendLoyaltyTierUpgradeNotification(opts: {
  clientId: string;
  tenantId: string;
  newTier: string;
  totalPoints: number;
}): Promise<void> {
  const { clientId, tenantId, newTier, totalPoints } = opts;

  const [client] = await db
    .select({
      name: clientsTable.name,
      email: clientsTable.email,
      whatsapp: clientsTable.whatsapp,
      whatsappOptIn: clientsTable.whatsappOptIn,
      emailOptIn: clientsTable.emailOptIn,
    })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  if (!client) return;

  const [tenant] = await db
    .select({ name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  const [settings] = await db
    .select({ value: systemConfigsTable.value })
    .from(systemConfigsTable)
    .where(
      and(
        eq(systemConfigsTable.tenantId, tenantId),
        eq(systemConfigsTable.key, "loyalty_settings"),
      ),
    )
    .limit(1);

  const agencyName = tenant?.name ?? "sua agência";
  const firstName = client.name.split(" ")[0];
  const newTierLabel = TIER_LABELS_PT[newTier] ?? newTier;
  const nextTierLabel = TIER_NEXT_LABEL[newTier] ?? null;
  const nextTierMin = TIER_NEXT_MIN[newTier] ?? null;
  const pointsToNext = nextTierMin !== null ? Math.max(0, nextTierMin - totalPoints) : null;
  const formattedPoints = totalPoints.toLocaleString("pt-BR");

  const interpolateWhatsappTemplate = (template: string): string =>
    template
      .replace(/\{\{?nome\}?\}/gi, firstName)
      .replace(/\{\{?nivel\}?\}/gi, newTierLabel)
      .replace(/\{\{?pontos\}?\}/gi, formattedPoints)
      .replace(/\{\{?proximo_nivel\}?\}/gi, nextTierLabel ?? "nível máximo");

  const sendEmailFallback = () => {
    if (client.emailOptIn === false || !client.email) return;

    sendLoyaltyTierUpgradeEmail({
      clientName: client.name,
      clientEmail: client.email,
      newTierLabel,
      totalPoints,
      nextTierLabel,
      pointsToNext,
      agencyName,
    })
      .then((result) => {
        if (!result.success) {
          logger.warn(
            { clientId, tenantId, error: result.error },
            "[loyalty] Email tier-upgrade send failed",
          );
        }
      })
      .catch((err) =>
        logger.warn({ err, clientId, tenantId }, "[loyalty] Email tier-upgrade send failed"),
      );
  };

  if (client.whatsappOptIn !== false && client.whatsapp) {
    const nextLine =
      pointsToNext !== null && nextTierLabel
        ? `\n\n📈 Próximo nível: *${nextTierLabel}* — faltam *${pointsToNext.toLocaleString("pt-BR")} pts*`
        : `\n\n🏆 Você atingiu o nível máximo do programa! Aproveite todos os benefícios.`;

    const storedTemplate = (settings?.value as { tierUpgradeWhatsappMessage?: unknown } | null)
      ?.tierUpgradeWhatsappMessage;
    const template = typeof storedTemplate === "string" ? storedTemplate.trim() : "";
    const message = template
      ? interpolateWhatsappTemplate(template)
      : `🎉 Parabéns, ${firstName}! Você subiu para o nível *${newTierLabel}* no programa de fidelidade da ${agencyName}!\n\n` +
        `💎 Pontos acumulados: *${formattedPoints} pts*${nextLine}`;

    enqueueOrSend(client.whatsapp, message, tenantId)
      .then((result) => {
        if (
          result.mode === "direct" &&
          !result.success &&
          result.error === "credentials_not_configured"
        ) {
          sendEmailFallback();
        }
      })
      .catch((err) =>
        logger.warn({ err, clientId, tenantId }, "[loyalty] WhatsApp tier-upgrade send failed"),
      );
  } else {
    sendEmailFallback();
  }

  await insertClientNotification(clientId, tenantId, "loyalty_tier_upgraded", {
    newTier,
    newTierLabel,
    totalPoints,
    nextTierLabel,
    agencyName,
  });
}

export interface LoyaltyAwardResult {
  credited: boolean;
  points: number;
}

/**
 * Awards loyalty points for a reservation (confirmation or payment trigger).
 * Idempotent: uses referenceType="reservation" + referenceId=reservationId
 * so only one earn transaction is ever created per reservation regardless of
 * how many times this is called (confirmed then paid, or paid directly).
 * Silently skips if the tenant has no active program or the client is not a member.
 */
export async function loyaltyAwardPointsForReservation(opts: {
  clientId: string;
  reservationId: string;
  amount: string | number;
  tenantId: string;
}): Promise<LoyaltyAwardResult> {
  const { clientId, reservationId, amount, tenantId } = opts;

  const [member] = await db
    .select()
    .from(loyaltyMembersTable)
    .where(and(eq(loyaltyMembersTable.tenantId, tenantId), eq(loyaltyMembersTable.clientId, clientId)))
    .limit(1);

  if (!member) return { credited: false, points: 0 };

  const [program] = await db
    .select()
    .from(loyaltyProgramsTable)
    .where(eq(loyaltyProgramsTable.id, member.programId))
    .limit(1);

  if (!program || !program.isActive) return { credited: false, points: 0 };

  const existing = await db
    .select({ id: loyaltyTransactionsTable.id })
    .from(loyaltyTransactionsTable)
    .where(
      and(
        eq(loyaltyTransactionsTable.tenantId, tenantId),
        eq(loyaltyTransactionsTable.memberId, member.id),
        eq(loyaltyTransactionsTable.type, "earn"),
        eq(loyaltyTransactionsTable.referenceId, reservationId),
        eq(loyaltyTransactionsTable.referenceType, "reservation")
      )
    )
    .limit(1);

  if (existing.length > 0) return { credited: false, points: 0 };

  const points = Math.floor(Number(amount) * Number(program.pointsPerReal));
  if (points <= 0) return { credited: false, points: 0 };

  await db.insert(loyaltyTransactionsTable).values({
    id: generateId(),
    tenantId,
    memberId: member.id,
    type: "earn",
    points,
    description: `Reserva confirmada`,
    referenceId: reservationId,
    referenceType: "reservation",
  });

  const newTotal = member.totalPoints + points;
  const newAvailable = member.availablePoints + points;
  const newTier = calculateTier(newTotal);

  await db
    .update(loyaltyMembersTable)
    .set({ totalPoints: newTotal, availablePoints: newAvailable, tier: newTier, lastActivityAt: new Date() })
    .where(eq(loyaltyMembersTable.id, member.id));

  if (isTierUpgrade(member.tier, newTier)) {
    sendLoyaltyTierUpgradeNotification({
      clientId: member.clientId,
      tenantId,
      newTier,
      totalPoints: newTotal,
    }).catch((err) =>
      logger.warn({ err, clientId, tenantId }, "[loyalty] tier-upgrade notification failed (reservation)"),
    );
  }

  return { credited: true, points };
}

/**
 * Reverses loyalty points that were awarded for a payment or reservation.
 * Called when a PAID payment is deleted to undo the associated earn transaction.
 *
 * - If `reservationId` is provided: reverses the reservation-level earn transaction
 *   (referenceType="reservation", referenceId=reservationId).
 * - Otherwise: reverses the payment-level earn transaction
 *   (referenceType="payment", referenceId=paymentId).
 *
 * A deduction transaction is inserted and member totals are updated.
 * Silently skips if no earn transaction exists (e.g. client not a program member,
 * or points were never awarded).
 */
export async function loyaltyReverseEarnedPoints(opts: {
  clientId: string;
  tenantId: string;
  paymentId: string;
  reservationId?: string | null;
}): Promise<void> {
  const { clientId, tenantId, paymentId, reservationId } = opts;

  const [member] = await db
    .select()
    .from(loyaltyMembersTable)
    .where(and(eq(loyaltyMembersTable.tenantId, tenantId), eq(loyaltyMembersTable.clientId, clientId)))
    .limit(1);

  if (!member) return;

  // Find the earn transaction to reverse
  const referenceId = reservationId ?? paymentId;
  const referenceType = reservationId ? "reservation" : "payment";

  const [earnTx] = await db
    .select()
    .from(loyaltyTransactionsTable)
    .where(
      and(
        eq(loyaltyTransactionsTable.tenantId, tenantId),
        eq(loyaltyTransactionsTable.memberId, member.id),
        eq(loyaltyTransactionsTable.type, "earn"),
        eq(loyaltyTransactionsTable.referenceId, referenceId),
        eq(loyaltyTransactionsTable.referenceType, referenceType),
      )
    )
    .limit(1);

  if (!earnTx) return; // Nothing to reverse

  const pointsToReverse = earnTx.points;
  if (pointsToReverse <= 0) return;

  // Insert a deduction transaction for audit trail
  await db.insert(loyaltyTransactionsTable).values({
    id: generateId(),
    tenantId,
    memberId: member.id,
    type: "redeem",
    points: -pointsToReverse,
    description: `Estorno de pagamento`,
    referenceId: paymentId,
    referenceType: "payment_reversal",
  });

  // Update member totals — clamp to 0 to avoid negative balances
  const newTotal = Math.max(0, member.totalPoints - pointsToReverse);
  const newAvailable = Math.max(0, member.availablePoints - pointsToReverse);
  const newTier = calculateTier(newTotal);

  await db
    .update(loyaltyMembersTable)
    .set({ totalPoints: newTotal, availablePoints: newAvailable, tier: newTier, lastActivityAt: new Date() })
    .where(eq(loyaltyMembersTable.id, member.id));

  // Delete the original earn transaction so points can be re-awarded if
  // the reservation is later fully paid again
  await db
    .delete(loyaltyTransactionsTable)
    .where(eq(loyaltyTransactionsTable.id, earnTx.id));
}

/**
 * Awards loyalty points for a standalone (non-reservation) payment.
 * Idempotent per paymentId. Also checks program.isActive.
 */
export async function loyaltyAwardPoints(opts: {
  clientId: string;
  paymentId: string;
  amount: string | number;
  tenantId: string;
}): Promise<LoyaltyAwardResult> {
  const { clientId, paymentId, amount, tenantId } = opts;

  const [member] = await db
    .select()
    .from(loyaltyMembersTable)
    .where(
      and(
        eq(loyaltyMembersTable.tenantId, tenantId),
        eq(loyaltyMembersTable.clientId, clientId)
      )
    )
    .limit(1);

  if (!member) return { credited: false, points: 0 };

  const [program] = await db
    .select()
    .from(loyaltyProgramsTable)
    .where(eq(loyaltyProgramsTable.id, member.programId))
    .limit(1);

  if (!program || !program.isActive) return { credited: false, points: 0 };

  const existing = await db
    .select({ id: loyaltyTransactionsTable.id })
    .from(loyaltyTransactionsTable)
    .where(
      and(
        eq(loyaltyTransactionsTable.tenantId, tenantId),
        eq(loyaltyTransactionsTable.memberId, member.id),
        eq(loyaltyTransactionsTable.referenceId, paymentId),
        eq(loyaltyTransactionsTable.referenceType, "payment")
      )
    )
    .limit(1);

  if (existing.length > 0) return { credited: false, points: 0 };

  const points = Math.floor(Number(amount) * Number(program.pointsPerReal));
  if (points <= 0) return { credited: false, points: 0 };

  await db.insert(loyaltyTransactionsTable).values({
    id: generateId(),
    tenantId,
    memberId: member.id,
    type: "earn",
    points,
    description: `Pagamento creditado`,
    referenceId: paymentId,
    referenceType: "payment",
  });

  const newTotal = member.totalPoints + points;
  const newAvailable = member.availablePoints + points;
  const newTier = calculateTier(newTotal);

  await db
    .update(loyaltyMembersTable)
    .set({
      totalPoints: newTotal,
      availablePoints: newAvailable,
      tier: newTier,
      lastActivityAt: new Date(),
    })
    .where(eq(loyaltyMembersTable.id, member.id));

  if (isTierUpgrade(member.tier, newTier)) {
    sendLoyaltyTierUpgradeNotification({
      clientId: member.clientId,
      tenantId,
      newTier,
      totalPoints: newTotal,
    }).catch((err) =>
      logger.warn({ err, clientId, tenantId }, "[loyalty] tier-upgrade notification failed (payment)"),
    );
  }

  return { credited: true, points };
}
