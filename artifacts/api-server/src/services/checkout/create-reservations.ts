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
import { syncReservationPaymentStatus, type DbExecutor } from "../../lib/reservation-payments";
import type { Tx } from "./tx";
import { syncClientDeal, type PipelineExecutor } from "../pipeline-deal-sync";
import { moveDealToStage } from "../pipeline-automation";
import { getStorefrontInitialPipelineStage } from "./storefront-pipeline";
import { recalculateClientFinancials } from "../client-financials";
import { findTripSeatConflicts } from "../reservation-capacity";

export const CHECKOUT_RESERVATION_HOLD_MINUTES = 30;

function checkoutReservationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CHECKOUT_RESERVATION_HOLD_MINUTES * 60_000);
}

export interface CreateReservationsResult {
  reservationIds: string[];
  reservationClientId: string | null;
  /** Trip IDs for which reservations were created this call — used by callers
   *  to fire broadcastSeatUpdate after the transaction commits. Empty when the
   *  order has no trip-linked products or when reservations already existed. */
  tripIds: string[];
  reservationExpiresAt: Date | null;
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
      subtotal: storeOrdersTable.subtotal,
      discountAmount: storeOrdersTable.discountAmount,
      totalAmount: storeOrdersTable.totalAmount,
      couponCode: storeOrdersTable.couponCode,
      pendingReferral: storeOrdersTable.pendingReferral,
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

  if (!order) return { reservationIds: [], reservationClientId: null, tripIds: [], reservationExpiresAt: null };

  const [store] = await exec
    .select({
      id: storesTable.id,
      tenantId: storesTable.tenantId,
      slug: storesTable.slug,
    })
    .from(storesTable)
    .where(and(eq(storesTable.id, order.storeId), eq(storesTable.tenantId, order.tenantId)))
    .limit(1);

  if (!store) return { reservationIds: [], reservationClientId: null, tripIds: [], reservationExpiresAt: null };

  const items = await exec
    .select({
      productId: storeOrderItemsTable.productId,
      quantity: storeOrderItemsTable.quantity,
      price: storeOrderItemsTable.price,
      total: storeOrderItemsTable.total,
    })
    .from(storeOrderItemsTable)
    .where(eq(storeOrderItemsTable.orderId, orderId));

  if (items.length === 0) return { reservationIds: [], reservationClientId: null, tripIds: [], reservationExpiresAt: null };

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
    const existing = tripLinkedProducts.get(product.tripId);
    const itemValue = item.total != null
      ? Number(item.total)
      : Number(item.price) * qty;
    if (existing) {
      existing.totalQty += qty;
      existing.totalValue += itemValue;
    } else {
      tripLinkedProducts.set(product.tripId, { product, totalQty: qty, totalValue: itemValue });
    }
  }

  if (tripLinkedProducts.size === 0) return { reservationIds: [], reservationClientId: null, tripIds: [], reservationExpiresAt: null };

  const submittedSeats = Array.isArray(order.seats)
    ? order.seats.map((seat) => seat.trim()).filter(Boolean)
    : [];
  if (submittedSeats.length > 0 && tripLinkedProducts.size !== 1) {
    throw new AppError(
      "A seleção de assentos deve pertencer a uma única viagem",
      400,
      "INVALID_SEAT_SELECTION",
    );
  }
  if (new Set(submittedSeats).size !== submittedSeats.length) {
    throw new AppError(
      "A seleção contém assentos duplicados",
      400,
      "DUPLICATE_SEATS",
    );
  }

  const existingReservations = await exec
    .select({ id: reservationsTable.id, expiresAt: reservationsTable.expiresAt })
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
      reservationExpiresAt: existingReservations
        .map((reservation) => reservation.expiresAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
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

  // Storefront discounts live on the order. Allocate them proportionally to
  // trip-linked lines so reservation, order and Pipeline values describe the
  // same net booking. Non-trip items keep their own share of the discount.
  const orderSubtotal = roundMoney(Number(order.subtotal ?? 0));
  const orderDiscount = roundMoney(Math.max(0, Number(order.discountAmount ?? 0)));
  const tripGrossTotal = sortedTripIds.reduce(
    (sum, tid) => sum + tripLinkedProducts.get(tid)!.totalValue,
    0,
  );
  const tripDiscountTotal = orderSubtotal > 0
    ? roundMoney(Math.min(orderDiscount, orderSubtotal) * Math.min(tripGrossTotal / orderSubtotal, 1))
    : 0;
  const reservationFinancials = new Map<string, { totalValue: number; discountTotal: number }>();
  let discountAllocated = 0;
  for (let idx = 0; idx < sortedTripIds.length; idx++) {
    const tripId = sortedTripIds[idx]!;
    const grossValue = tripLinkedProducts.get(tripId)!.totalValue;
    const isLastTrip = idx === sortedTripIds.length - 1;
    const discountTotal = isLastTrip
      ? roundMoney(tripDiscountTotal - discountAllocated)
      : roundMoney(tripGrossTotal > 0 ? tripDiscountTotal * (grossValue / tripGrossTotal) : 0);
    discountAllocated = roundMoney(discountAllocated + discountTotal);
    reservationFinancials.set(tripId, {
      totalValue: roundMoney(Math.max(0, grossValue - discountTotal)),
      discountTotal,
    });
  }
  const orderTotalValue = [...reservationFinancials.values()].reduce((sum, value) => sum + value.totalValue, 0);
  const depositAmount = Number(order.depositAmount ?? 0);
  let depositAllocated = 0;
  const reservationExpiresAt = checkoutReservationExpiry();

  for (let idx = 0; idx < sortedTripIds.length; idx++) {
    const tripId = sortedTripIds[idx]!;
    const isLastTrip = idx === sortedTripIds.length - 1;
    const { product, totalQty } = tripLinkedProducts.get(tripId)!;
    const financial = reservationFinancials.get(tripId)!;
    const totalValue = financial.totalValue;
    const discountTotal = financial.discountTotal;

    // Row-level lock prevents concurrent paid orders from overselling the same trip.
    const lockResult = await exec.execute(
      sql`SELECT id, available_seats, total_capacity, show_seat_map, seat_map, type FROM trips WHERE id = ${tripId} AND tenant_id = ${order.tenantId} FOR UPDATE`,
    );
    const tripRow = (lockResult as unknown as { rows: Array<{
      id: string;
      available_seats: number;
      total_capacity: number | null;
      show_seat_map: boolean;
      seat_map: Record<string, { status?: string }> | null;
      type: string;
    }> }).rows[0];

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
    const customerSeats = submittedSeats;
    let reservationSeats: string[] = [];

    if (customerSeats.length > 0 && tripRow.show_seat_map !== false) {
      if (customerSeats.length !== totalQty) {
        throw new AppError(
          `Selecione exatamente ${totalQty} assento(s) para "${product.name}"`,
          400,
          "SEAT_QUANTITY_MISMATCH",
        );
      }
      const seatMap = tripRow.seat_map ?? {};
      const invalidSeats = customerSeats.filter((seat) => {
        const definition = seatMap[seat];
        return !definition || ["blocked", "unavailable", "disabled"].includes(definition.status ?? "");
      });
      if (invalidSeats.length > 0) {
        throw new AppError(
          "Um ou mais assentos não pertencem ao mapa disponível desta viagem",
          400,
          "INVALID_SEATS",
          { invalidSeats },
        );
      }
      const conflictingSeats = await findTripSeatConflicts(exec, order.tenantId, tripId, customerSeats);
      if (conflictingSeats.length > 0) {
        throw new AppError(
          "Um ou mais assentos acabaram de ser ocupados",
          409,
          "SEAT_CONFLICT",
          { conflictingSeats },
        );
      }
      reservationSeats = customerSeats;
    } else if (customerSeats.length > 0) {
      throw new AppError(
        "Esta viagem não aceita seleção manual de assentos",
        400,
        "SEAT_MAP_DISABLED",
      );
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

    // Proportionally retain the requested deposit on each reservation. It is
    // not a payment: only a later gateway/manual payment row may populate
    // paidValue and confirm the reservation.
    const resDeposit = depositAmount > 0
      ? roundMoney(isLastTrip
        ? depositAmount - depositAllocated
        : (orderTotalValue > 0 ? (totalValue / orderTotalValue) * depositAmount : 0))
      : 0;
    depositAllocated = roundMoney(depositAllocated + resDeposit);
    const resPaid = 0;
    const resBalance = totalValue;
    const pendingReferral = order.pendingReferral as { code?: string } | null;
    const referralCode = pendingReferral?.code ?? null;
    const couponCode = order.couponCode ?? null;

    await exec.insert(reservationsTable).values({
      id: reservationId,
      tenantId: order.tenantId,
      tripId,
      clientId: order.clientId ?? null,
      seats: reservationSeats,
      capacityUnits: totalQty,
      boardingLocationId: order.boardingLocationId ?? null,
      totalValue: totalValue.toFixed(2),
      paidValue: String(resPaid),
      balance: String(resBalance),
      status: RESERVATION_STATUS.PENDING,
      expiresAt: reservationExpiresAt,
      ...(resDeposit > 0 ? { depositAmount: String(resDeposit) } : {}),
      voucherCode,
      reservationNumber,
      qrCode: `QR-${voucherCode}`,
      storeOrderId: order.orderNumber,
      createdById: ctx.reservationCreatedById,
      paymentMethod: order.paymentMethod ?? null,
      installments: order.installments ?? 1,
      ...(couponCode && discountTotal > 0 ? {
        discountCouponCode: couponCode,
        discountCouponAmount: discountTotal.toFixed(2),
      } : {}),
      ...(referralCode && discountTotal > 0 ? {
        discountReferralCode: referralCode,
        discountReferralAmount: discountTotal.toFixed(2),
      } : {}),
      ...(discountTotal > 0 ? { discountTotal: discountTotal.toFixed(2) } : {}),
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
          targetStageName: getStorefrontInitialPipelineStage(false),
          executor: exec as unknown as PipelineExecutor,
        },
      );
    }
  }

  return {
    reservationIds,
    reservationClientId: order.clientId ?? null,
    tripIds: sortedTripIds,
    reservationExpiresAt,
  };
}

export interface ConfirmReservationsResult {
  reservationIds: string[];
  allocatedAmount: number;
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
  eventId = generateId(),
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
  if (!order || amount <= 0) return { reservationIds: [], allocatedAmount: 0 };

  const reservations = await tx
    .select({
      id: reservationsTable.id,
      clientId: reservationsTable.clientId,
      totalValue: reservationsTable.totalValue,
      paidValue: reservationsTable.paidValue,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, order.tenantId),
      eq(reservationsTable.storeOrderId, order.orderNumber),
    ));
  if (reservations.length === 0) return { reservationIds: [], allocatedAmount: 0 };

  const totalReservationOutstanding = roundMoney(reservations.reduce(
    (acc, r) => acc + Math.max(0, Number(r.totalValue) - Number(r.paidValue ?? 0)),
    0,
  ));
  if (totalReservationOutstanding <= 0) {
    return { reservationIds: reservations.map((r) => r.id), allocatedAmount: 0 };
  }
  const allocatable = Math.min(amount, totalReservationOutstanding);

  let allocated = 0;
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i]!;
    const isLast = i === reservations.length - 1;
    const share = isLast
      ? roundMoney(allocatable - allocated)
      : roundMoney(
        (Math.max(0, Number(r.totalValue) - Number(r.paidValue ?? 0)) / totalReservationOutstanding)
        * allocatable,
      );
    allocated = roundMoney(allocated + share);
    if (share <= 0) continue;

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
      transactionId: eventId,
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

  if (order.clientId) {
    await recalculateClientFinancials(order.clientId, order.tenantId, tx);
  }

  return { reservationIds: reservations.map((r) => r.id), allocatedAmount: allocated };
}
