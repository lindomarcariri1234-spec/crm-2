import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ update: mockUpdate }),
  );
  const tables = {
    storeOrdersTable: { __name: "store_orders" },
    reservationsTable: {},
    paymentsTable: {},
    storesTable: {},
    tripsTable: {},
  };
  return { mockWhere, mockSet, mockUpdate, mockTransaction, tables };
});

vi.mock("@workspace/db", () => ({
  db: { transaction: h.mockTransaction },
  ...h.tables,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  inArray: vi.fn(),
  ne: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid" },
  PAYMENT_TYPE: { RECEIVABLE: "receivable" },
  RESERVATION_STATUS: { PENDING: "pending", CONFIRMED: "confirmed" },
  STORE_ORDER_STATUS: { CANCELLED: "cancelled" },
  STORE_PAYMENT_STATUS: { REFUNDED: "refunded", PAID: "paid" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/crypto.js", () => ({
  decryptOrPassthrough: vi.fn((value: string | null | undefined) => value ?? null),
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn(),
}));
vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn() }));
vi.mock("../services/checkout/post-booking.js", () => ({
  runDeferredOrderAccounting: vi.fn(),
  runPostPaymentSideEffects: vi.fn(),
}));
vi.mock("../services/client-financials.js", () => ({
  recalculateClientFinancials: vi.fn(),
}));
vi.mock("../services/checkout/persist-order.js", () => ({
  applyOrderInventoryEffects: vi.fn(),
  releaseOrderInventoryHolds: vi.fn(),
  reverseOrderInventoryEffects: vi.fn(),
}));
vi.mock("../services/checkout/cancel-partner-items.js", () => ({
  cancelPartnerOrderItems: vi.fn(),
}));
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn(),
}));
vi.mock("../services/checkout/order-referral-reversal.js", () => ({
  reverseProductOnlyOrderReferral: vi.fn(),
  reverseTripOrderReferrals: vi.fn(),
}));
vi.mock("../services/checkout/deferred-referral-effects.js", () => ({
  restoreSpentCreditForOrder: vi.fn(),
}));
vi.mock("../lib/reservation-payments.js", () => ({
  syncReservationPaymentStatus: vi.fn(),
  paymentExistsForGatewayTx: vi.fn(),
}));
vi.mock("../services/whatsapp-attendance.js", () => ({
  processEvolutionInbound: vi.fn(),
  processEvolutionDeliveryStatus: vi.fn(),
}));
vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn(),
}));
vi.mock("../services/outbound-delivery.js", () => ({
  updateOutboundDeliveryFromWebhook: vi.fn(),
}));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "generated-id") }));
vi.mock("../lib/pricing.js", () => ({ roundMoney: vi.fn((value: number) => value) }));
vi.mock("../services/settlements/financial-ledger.js", () => ({
  adjustOrderSettlement: vi.fn(),
  recordOrderPaymentSettlement: vi.fn(),
  reverseOrderSettlement: vi.fn(),
}));

import { handleStripeEvent } from "../routes/webhooks.js";

const STORE = {
  storeId: "store-001",
  tenantId: "tenant-001",
  slug: "minha-loja",
  mpAccessToken: null,
  stripeWebhookSecret: "whsec_test",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Stripe storefront payment instructions", () => {
  it("persists Pix copy-paste data and the Stripe QR image URL", async () => {
    await handleStripeEvent({
      id: "evt_pix_processing",
      type: "payment_intent.processing",
      data: {
        object: {
          id: "pi_pix",
          next_action: {
            type: "display_qr_code",
            display_qr_code: {
              data: "000201010212PIX-COPY-PASTE",
              image_url_png: "https://stripe.example/pix.png",
            },
          },
        },
      },
    }, STORE);

    expect(h.mockSet).toHaveBeenCalledWith({
      pixQrCode: "000201010212PIX-COPY-PASTE",
      pixCopyPaste: "000201010212PIX-COPY-PASTE",
      pixQrCodeUrl: "https://stripe.example/pix.png",
    });
    expect(h.mockWhere).toHaveBeenCalled();
  });

  it("persists the hosted boleto URL and barcode", async () => {
    await handleStripeEvent({
      id: "evt_boleto_processing",
      type: "payment_intent.processing",
      data: {
        object: {
          id: "pi_boleto",
          next_action: {
            type: "display_boleto",
            display_boleto: {
              hosted_voucher_url: "https://stripe.example/boleto.pdf",
              number: "34191790010104351004791020150008291070026000",
            },
          },
        },
      },
    }, STORE);

    expect(h.mockSet).toHaveBeenCalledWith({
      boletoUrl: "https://stripe.example/boleto.pdf",
      boletoBarcode: "34191790010104351004791020150008291070026000",
    });
  });

  it("does not write payment instructions when Stripe sends no next action", async () => {
    await handleStripeEvent({
      id: "evt_without_instructions",
      type: "payment_intent.processing",
      data: { object: { id: "pi_without_instructions" } },
    }, STORE);

    expect(h.mockTransaction).toHaveBeenCalledTimes(1);
    expect(h.mockSet).not.toHaveBeenCalled();
  });
});