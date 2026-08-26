import { db } from "@workspace/db";
import {
  storesTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeProductsTable,
  reservationsTable,
  passengersTable,
  tripsTable,
  paymentsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { generateId, generateVoucherCode } from "../../lib/id";
import { AppError } from "../../lib/errors";
import { RESERVATION_STATUS, PAYMENT_STATUS } from "@workspace/permissions";
import {
  tripTypeToCode,
  nextReservationSequence,
  buildReservationNumber,
  getYearMonth,
  getTenantReservationPrefix,
} from "../../lib/reservation-number";
import { loadReservationContext } from "./reservation-context";
import { upsertCheckoutClient } from "./checkout-user";
import { roundMoney } from "../../lib/pricing";
import { syncReservationPaymentStatus, paymentExistsForGatewayTx, type DbExecutor } from "../../lib/reservation-payments";
import type { Tx } from "./tx";
import { syncClientDeal, type PipelineExecutor } from "../pipeline-deal-sync";
import { moveDealToStage } from "../pipeline-automation";

export interface CreateReservationsResult {
  reservationIds: string[];
  reservationClientId: string | null;
  /** Trip IDs for which reservations were created this call — used by callers
   *  to fire broadcastSeatUpdate after the transaction commits. Empty when the
   *  order has no trip-linked products or when reservations already existed. */
  tripIds: string[];
}

/**
 * Creates reservations (status = pending) and decrements availableSeats for a
 * store order.
 *
 * Called immediately at vitrine checkout — right after `persistCheckoutOrder`
 * commits — so the agency sees the reservation, CRM client, and Pipeline deal
 * right away, before payment is confirmed. PIX/boleto/transfer payments can
 * take minutes or days to confirm, so waiting for payment to create the
 * reservation left the CRM empty during that window.
 *
 * It is also called again from the payment-confirmation paths (Stripe/Mercado
 * Pago webhook and manual payment entry) for backward compatibility and
 * safety — that second call is a no-op because the reservations already
 * exist (see idempotency below). Payment confirmation itself is handled by
 * `confirmReservationsForOrder`, which transitions the existing reservation to
 * `confirmed` instead of creating a new one.
 *
 * Idempotent: if reservations for this order already exist, returns their IDs
 * without creating duplicates.
 *
 * Concurrency safety: each trip row is locked with FOR UPDATE before any
 * capacity check or decrement to prevent oversell under concurrent paid orders.
 * The function always runs inside a transaction — if a tx is not provided it
 * creates its own.
 *
 * @param orderId - The store_orders.id to create reservations for.
 * @param tx - Optional DB transaction/executor; creates one if omitted.
 */
export async function createReservationsForOrder(
  orderId: string,
  tx?: Tx,
): Promise<CreateReservationsResult> {
  // Ensure we always run inside a transaction so the FOR UPDATE locks are meaningful.
  if (!tx) {
    return db.transaction((newTx) =>
      createReservationsForOrder(orderId, newTx as unknown as Tx),
    );
  }

  const exec = tx;

  const [orderRaw] = await exec
    .select({
      id: storeOrdersTable.id,
      orderNumber: storeOrdersTable.orderNumber,
      tenantId: storeOrdersTable.tenantId,
      storeId: storeOrdersTable.storeId,
      clientId: storeOrdersTable.clientId,
      customerName: storeOrdersTable.customerName,
      customerEmail: storeOrdersTable.customerEmail,
      customerPhone: storeOrdersTable.customerPhone,
      customerCpf: storeOrdersTable.customerCpf,
      customerBirthdate: storeOrdersTable.customerBirthdate,
      customerNotes: storeOrdersTable.customerNotes,
      // Logistics chosen by the customer during vitrine checkout
      boardingLocationId: storeOrdersTable.boardingLocationId,
      seats: storeOrdersTable.seats,
      coPassengers: storeOrdersTable.coPassengers,
      paymentMethod: storeOrdersTable.paymentMethod,
      installments: storeOrdersTable.installments,
      depositAmount: storeOrdersTable.depositAmount,
      amountRemaining: storeOrdersTable.amountRemaining,
    })
    .from(storeOrdersTable)
    .where(eq(storeOrdersTable.id, orderId))
    .limit(1);
  // Allow clientId to be mutated below (CRM client upsert on payment confirmation).
  const order = orderRaw ? { ...orderRaw } : undefined;

  if (!order) return { reservationIds: [], reservationClientId: null, tripIds: [] };

  const [store] = await exec
    .select({
      id: storesTable.id,
      tenantId: storesTable.tenantId,
      slug: storesTable.slug,
    })
    .from(storesTable)
    .where(and(eq(storesTable.id, order.storeId), eq(storesTable.tenantId, order.tenantId)))
    .limit(1);

  if (!store) return { reservationIds: [], reservationClientId: null, tripIds: [] };

  const items = await exec
    .select({
      productId: storeOrderItemsTable.productId,
      quantity: storeOrderItemsTable.quantity,
      price: storeOrderItemsTable.price,
    })
    .from(storeOrderItemsTable)
    .where(eq(storeOrderItemsTable.orderId, orderId));

  if (items.length === 0) return { reservationIds: [], reservationClientId: null, tripIds: [] };

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await exec
    .select()
    .from(storeProductsTable)
    .where(inArray(storeProductsTable.id, productIds));

  const productMap = new Map(products.map((p) => [p.id, p]));

  const tripLinkedProducts = new Map<string, {
    product: typeof storeProductsTable.$inferSelect;
    totalQty: number;
    totalValue: number;
  }>();

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product?.tripId) continue;
    const qty = item.quantity;
    const price = Number(item.price);
    const existing = tripLinkedProducts.get(product.tripId);
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += price * qty;
    } else {
      tripLinkedProducts.set(product.tripId, { product, totalQty: qty, totalValue: price * qty });
    }
  }

  if (tripLinkedProducts.size === 0) return { reservationIds: [], reservationClientId: null, tripIds: [] };

  const existingReservations = await exec
    .select({ id: reservationsTable.id })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, order.tenantId),
      eq(reservationsTable.storeOrderId, order.orderNumber),
    ));

  if (existingReservations.length > 0) {
    // Reservations already exist (idempotent re-call). tripIds is empty because
    // no new reservations were created — callers should not re-broadcast.
    return {
      reservationIds: existingReservations.map((r) => r.id),
      reservationClientId: order.clientId ?? null,
      tripIds: [],
    };
  }

  const ctx = await loadReservationContext({
    tenantId: order.tenantId,
    tripIds: [...tripLinkedProducts.keys()],
  });
  if (!ctx.reservationCreatedById) {
    throw new AppError(
      "Não foi possível criar a reserva: nenhum usuário ativo encontrado para esta agência",
      500,
      "RESERVATION_NO_AGENCY_USER",
    );
  }

  // Create or link the CRM client now that payment is confirmed.
  // This is intentionally deferred from order-creation time so that anonymous,
  // non-paying checkout submissions cannot create or mutate clientsTable rows.
  if (!order.clientId) {
    const clientBirthDate = order.customerBirthdate
      ? new Date(order.customerBirthdate + "T12:00:00")
      : null;
    const clientResult = await upsertCheckoutClient(exec, {
      tenantId: order.tenantId,
      email: order.customerEmail,
      name: order.customerName,
      phone: order.customerPhone ?? undefined,
      cpf: order.customerCpf ?? undefined,
      birthDate: clientBirthDate,
      createdById: ctx.reservationCreatedById,
    });
    order.clientId = clientResult.clientId;
    // Persist the link back to the order row so future calls see the clientId.
    await exec.update(storeOrdersTable)
      .set({ clientId: clientResult.clientId })
      .where(eq(storeOrdersTable.id, order.id));
  }

  const tenantResPrefix = await getTenantReservationPrefix(order.tenantId);
  const resYearMonth = getYearMonth();

  const reservationIds: string[] = [];

  // Lock trips in a deterministic order to prevent deadlocks under concurrency.
  const sortedTripIds = [...tripLinkedProducts.keys()].sort();

  // Compute total order value across all trip-linked products so we can
  // proportionally allocate a deposit when an order contains multiple trips.
  const orderTotalValue = sortedTripIds.reduce(
    (sum, tid) => sum + tripLinkedProducts.get(tid)!.totalValue,
    0,
  );
  const depositAmount = Number(order.depositAmount ?? 0);
  let depositAllocated = 0;

  for (let idx = 0; idx < sortedTripIds.length; idx++) {
    const tripId = sortedTripIds[idx]!;
    const isLastTrip = idx === sortedTripIds.length - 1;
    const { product, totalQty, totalValue } = tripLinkedProducts.get(tripId)!;

    // Row-level lock prevents concurrent paid orders from overselling the same trip.
    const lockResult = await exec.execute(
      sql`SELECT id, available_seats, total_capacity, show_seat_map, type FROM trips WHERE id = ${tripId} AND tenant_id = ${order.tenantId} FOR UPDATE`,
    );
    const tripRow = (lockResult as unknown as { rows: Array<{ id: string; available_seats: number; total_capacity: number | null; show_seat_map: boolean; type: string }> }).rows[0];

    if (!tripRow) {
      throw new AppError(
        `Viagem vinculada ao produto "${product.name}" não encontrada`,
        404,
        "TRIP_NOT_FOUND",
      );
    }

    const currentSeats = Number(tripRow.available_seats);
    if (currentSeats < totalQty) {
      throw new AppError(
        `Vagas insuficientes para "${product.name}". Disponível: ${currentSeats}, solicitado: ${totalQty}`,
        409,
        "INSUFFICIENT_SEATS",
      );
    }

    // Determine which seats to assign to this reservation:
    //
    // Priority 1 — customer's own selection (seat map was shown in vitrine).
    //   order.seats is populated when the customer picked seats during checkout.
    //   We honour that choice directly rather than re-assigning.
    //
    // Priority 2 — auto-assign sequential seats (seat map hidden on this trip).
    //   When the seat-selection step is hidden, the system assigns the next
    //   available seats (1, 2, 3…) at payment-confirmation time so the
    //   reservation is never created with an empty seat list.
    //
    // Priority 3 — empty (seat map shown but customer sent no seats, or qty
    //   mismatch). The agency can assign seats manually afterwards.
    const customerSeats: string[] = Array.isArray(order.seats) ? order.seats : [];
    let reservationSeats: string[] = [];

    if (customerSeats.length > 0 && tripRow.show_seat_map !== false) {
      // The customer selected seats in the vitrine — use them directly.
      reservationSeats = customerSeats.slice(0, totalQty);
    } else if (tripRow.show_seat_map === false && tripRow.total_capacity && tripRow.total_capacity > 0) {
      // Auto-assign sequential seats for trips without a visible seat map.
      const existingRows = await exec
        .select({ seats: reservationsTable.seats })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tripId, tripId),
            eq(reservationsTable.tenantId, order.tenantId),
            sql`${reservationsTable.status} != 'cancelled'`,
          ),
        );
      const occupied = new Set(existingRows.flatMap((r) => r.seats));
      const capacity = tripRow.total_capacity;
      for (let n = 1; n <= capacity && reservationSeats.length < totalQty; n++) {
        if (!occupied.has(String(n))) {
          reservationSeats.push(String(n));
        }
      }
    }

    const voucherCode = generateVoucherCode();
    const reservationId = generateId();
    reservationIds.push(reservationId);

    const resTypeCode = tripTypeToCode(tripRow.type ?? "");
    const resSeq = await nextReservationSequence(order.tenantId, resYearMonth, resTypeCode, exec as Tx);
    const reservationNumber = buildReservationNumber(tenantResPrefix, resTypeCode, resYearMonth, resSeq);

    // Proportionally allocate the order-level deposit across each reservation.
    // The last reservation absorbs rounding remainder to guarantee the sum
    // of all reservation paidValues equals the order depositAmount exactly.
    const resPaid = depositAmount > 0
      ? roundMoney(isLastTrip
        ? depositAmount - depositAllocated
        : (orderTotalValue > 0 ? (totalValue / orderTotalValue) * depositAmount : 0))
      : 0;
    depositAllocated = roundMoney(depositAllocated + resPaid);
    const resBalance = roundMoney(totalValue - resPaid);
    const isDepositConfirmed = depositAmount > 0;

    await exec.insert(reservationsTable).values({
      id: reservationId,
      tenantId: order.tenantId,
      tripId,
      clientId: order.clientId ?? null,
      seats: reservationSeats,
      boardingLocationId: order.boardingLocationId ?? null,
      totalValue: totalValue.toFixed(2),
      paidValue: String(resPaid),
      balance: String(resBalance),
      status: isDepositConfirmed ? RESERVATION_STATUS.CONFIRMED : RESERVATION_STATUS.PENDING,
      ...(isDepositConfirmed ? { confirmedAt: new Date(), depositAmount: String(resPaid) } : {}),
      voucherCode,
      reservationNumber,
      qrCode: `QR-${voucherCode}`,
      storeOrderId: order.orderNumber,
      createdById: ctx.reservationCreatedById,
      paymentMethod: order.paymentMethod ?? null,
      installments: order.installments ?? 1,
      ...(order.customerNotes ? { notes: order.customerNotes } : {}),
    });

    // Create one passenger record per seat.
    //
    // Seat 0 (reservationSeats[0]) → primary passenger (the buyer).
    // Seat N (reservationSeats[N]) → co-passenger[N-1] from the order, or
    //   "Passageiro N+1" when no co-passenger data was collected.
    //
    // This ensures the ANTT manifest and Painel de Embarque are fully
    // populated immediately after payment without the agency filling in
    // passengers manually.
    const clientBirthDateForPassenger = order.customerBirthdate
      ? new Date(order.customerBirthdate + "T12:00:00")
      : undefined;
    const coPassengers = Array.isArray(order.coPassengers) ? order.coPassengers : [];

    // Primary passenger (buyer)
    await exec.insert(passengersTable).values({
      id: generateId(),
      reservationId,
      name: order.customerName,
      ...(order.customerCpf ? { cpf: order.customerCpf } : {}),
      ...(order.customerPhone ? { phone: order.customerPhone } : {}),
      ...(clientBirthDateForPassenger ? { birthDate: clientBirthDateForPassenger } : {}),
      ageCategory: "adult",
      isPrimary: true,
      seatNumber: reservationSeats[0] ?? null,
      ...(order.boardingLocationId ? { boardingLocationId: order.boardingLocationId } : {}),
    });

    // Additional passengers (seats 2, 3, … totalQty)
    for (let i = 1; i < totalQty; i++) {
      const co = coPassengers[i - 1];
      const passengerName = co?.name?.trim() || `Passageiro ${i + 1}`;
      await exec.insert(passengersTable).values({
        id: generateId(),
        reservationId,
        name: passengerName,
        ...(co?.cpf ? { cpf: co.cpf } : {}),
        ...(co?.phone ? { phone: co.phone } : {}),
        ageCategory: "adult",
        isPrimary: false,
        seatNumber: reservationSeats[i] ?? null,
        ...(order.boardingLocationId ? { boardingLocationId: order.boardingLocationId } : {}),
      });
    }

    // Guarded decrement: only proceeds if available_seats is still >= qty (race-condition safety).
    // The FOR UPDATE lock above already prevents concurrent modifications within a transaction,
    // but this WHERE guard also protects against bugs or edge cases that bypass the lock.
    const updateResult = await exec.execute(
      sql`UPDATE trips
          SET available_seats = available_seats - ${totalQty},
              reserved_seats  = reserved_seats  + ${totalQty},
              updated_at      = NOW()
          WHERE id = ${tripId}
            AND tenant_id = ${order.tenantId}
            AND available_seats >= ${totalQty}`,
    );

    const rowsAffected = (updateResult as unknown as { rowCount: number | null }).rowCount ?? 0;
    if (rowsAffected === 0) {
      // Race-condition guard: another transaction won the lock window or seats dropped to 0.
      throw new AppError(
        `Vagas insuficientes para "${product.name}" no momento da confirmação do pagamento`,
        409,
        "INSUFFICIENT_SEATS",
      );
    }

    if (order.clientId) {
      await syncClientDeal(
        order.clientId,
        order.tenantId,
        tripId,
        totalValue,
        ctx.reservationCreatedById,
        {
          reservationId,
          source: "website",
          targetStageName: isDepositConfirmed ? "Reserva Criada" : "Vitrine",
          executor: exec as unknown as PipelineExecutor,
        },
      );
    }
  }

  return { reservationIds, reservationClientId: order.clientId ?? null, tripIds: sortedTripIds };
}

export interface ConfirmReservationsResult {
  reservationIds: string[];
}

/**
 * Confirms payment for the reservations already created at checkout time.
 *
 * Since `createReservationsForOrder` now runs at checkout, by the time a
 * payment is confirmed (Stripe/Mercado Pago webhook or manual payment entry)
 * the reservation already exists with `status = "pending"`. This function
 * finds those existing reservations, records a `paid` payment for each
 * (proportionally allocated across reservations when a mixed cart contains
 * non-reservation items), and lets `syncReservationPaymentStatus` promote
 * `status` to `"confirmed"` once `paidValue >= totalValue`.
 *
 * Idempotent: each reservation's payment is tagged with
 * `gateway = "manual"` + `transactionId = <reservationId>`, so calling this
 * twice for the same order (e.g. a duplicate manual-payment PUT) never
 * inserts a second payment row for the same reservation.
 *
 * Note: Stripe/Mercado Pago webhook confirmations do NOT call this function —
 * they already insert their own gateway-tagged payment rows and call
 * `syncReservationPaymentStatus` directly in `applyGatewayPayment`
 * (webhooks.ts). This function exists for the manual (agency-entered)
 * payment-confirmation path, which had no equivalent step.
 *
 * @param orderId - The store_orders.id whose payment was just confirmed.
 * @param amount - The amount to allocate across the order's reservations (typically order.totalAmount).
 * @param tx - DB transaction/executor.
 */
export async function confirmReservationsForOrder(
  orderId: string,
  amount: number,
  tx: DbExecutor,
): Promise<ConfirmReservationsResult> {
  const [order] = await tx
    .select({
      id: storeOrdersTable.id,
      orderNumber: storeOrdersTable.orderNumber,
      tenantId: storeOrdersTable.tenantId,
      clientId: storeOrdersTable.clientId,
      paymentMethod: storeOrdersTable.paymentMethod,
    })
    .from(storeOrdersTable)
    .where(eq(storeOrdersTable.id, orderId))
    .limit(1);
  if (!order || amount <= 0) return { reservationIds: [] };

  const reservations = await tx
    .select({
      id: reservationsTable.id,
      clientId: reservationsTable.clientId,
      totalValue: reservationsTable.totalValue,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, order.tenantId),
      eq(reservationsTable.storeOrderId, order.orderNumber),
    ));
  if (reservations.length === 0) return { reservationIds: [] };

  const totalReservationValue = reservations.reduce((acc, r) => acc + Number(r.totalValue), 0);
  if (totalReservationValue <= 0) return { reservationIds: reservations.map((r) => r.id) };
  const allocatable = Math.min(amount, totalReservationValue);

  let allocated = 0;
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i]!;
    const isLast = i === reservations.length - 1;
    const share = isLast
      ? roundMoney(allocatable - allocated)
      : roundMoney((Number(r.totalValue) / totalReservationValue) * allocatable);
    allocated = roundMoney(allocated + share);
    if (share <= 0) continue;

    const alreadyPaid = await paymentExistsForGatewayTx(order.tenantId, "manual", r.id, tx);
    if (alreadyPaid) continue;

    await tx.insert(paymentsTable).values({
      id: generateId(),
      tenantId: order.tenantId,
      reservationId: r.id,
      clientId: order.clientId ?? null,
      orderId: order.id,
      type: "receivable",
      category: "reservation",
      amount: String(share),
      paymentMethod: order.paymentMethod ?? "manual",
      installmentNumber: i + 1,
      totalInstallments: reservations.length,
      dueDate: new Date(),
      paidAt: new Date(),
      status: PAYMENT_STATUS.PAID,
      gateway: "manual",
      transactionId: r.id,
      description: "Pagamento confirmado manualmente pela agência",
    });

    await syncReservationPaymentStatus(r.id, order.tenantId, tx);
    await moveDealToStage({
      tenantId: order.tenantId,
      clientId: r.clientId,
      reservationId: r.id,
      targetStageName: "Pagamento Confirmado",
      forwardOnly: true,
      executor: tx,
    });
  }

  return { reservationIds: reservations.map((r) => r.id) };
}
