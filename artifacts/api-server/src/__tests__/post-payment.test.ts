import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// runPostPaymentSideEffects tests
//
// Verifies that referral-code minting, portal-account provisioning, and
// client-activity recording are orchestrated correctly AFTER payment
// confirmation, and only for the right kinds of orders:
//   - referral code is minted only when the order has a clientId
//   - portal account is provisioned only when the paid order produced trip
//     reservations (product-only orders get no portal account)
//   - writeClientActivity("order_created") is called after payment, only when
//     the order has a clientId AND an active agency user exists
//   - a missing order is a no-op
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  storeOrdersTable: {
    id: "id",
    orderNumber: "order_number",
    tenantId: "tenant_id",
    storeId: "store_id",
    clientId: "client_id",
    customerName: "customer_name",
    customerEmail: "customer_email",
  },
  reservationsTable: {
    id: "id",
    tenantId: "tenant_id",
    storeOrderId: "store_order_id",
  },
  storesTable: {
    id: "id",
    tenantId: "tenant_id",
    name: "name",
    slug: "slug",
    logo: "logo",
    customDomain: "custom_domain",
  },
  usersTable: {
    id: "id",
    tenantId: "tenant_id",
    isActive: "is_active",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

const mockEnsurePortalAccount = vi.fn();
vi.mock("../services/checkout/portal-account.js", () => ({
  ensurePortalAccount: (...args: unknown[]) => mockEnsurePortalAccount(...args),
}));

const mockGenerateAndAssignReferralCode = vi.fn();
vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: (...args: unknown[]) =>
    mockGenerateAndAssignReferralCode(...args),
}));

vi.mock("../lib/id.js", () => ({
  generateReferralCode: vi.fn(() => "JOAO2026ABCDEFGH"),
}));

const mockWriteClientActivity = vi.fn();
vi.mock("../lib/activities.js", () => ({
  writeClientActivity: (...args: unknown[]) => mockWriteClientActivity(...args),
}));

const mockApplyDeferredOrderCredits = vi.fn();
vi.mock("../services/checkout/deferred-referral-effects.js", () => ({
  applyDeferredOrderCredits: (...args: unknown[]) =>
    mockApplyDeferredOrderCredits(...args),
}));

// detectAndNotifyTripOverlap runs fire-and-forget after reservations are found.
// Mock it so it never makes real db calls and doesn't interfere with the slot queue.
const mockDetectAndNotifyTripOverlap = vi.fn();
vi.mock("../lib/trip-overlap-notify.js", () => ({
  detectAndNotifyTripOverlap: (...args: unknown[]) =>
    mockDetectAndNotifyTripOverlap(...args),
}));

const mockDispatchReferralConvertedEmail = vi.fn();
const mockDispatchReferralTierUpgradeEmail = vi.fn();
const mockDispatchReferralLoyaltyPointsEmail = vi.fn();
vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralConvertedEmail: (...args: unknown[]) =>
    mockDispatchReferralConvertedEmail(...args),
  dispatchReferralTierUpgradeEmail: (...args: unknown[]) =>
    mockDispatchReferralTierUpgradeEmail(...args),
  dispatchReferralLoyaltyPointsEmail: (...args: unknown[]) =>
    mockDispatchReferralLoyaltyPointsEmail(...args),
}));

const mockDispatchWhatsAppReferralConverted = vi.fn();
vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReferralConverted: (...args: unknown[]) =>
    mockDispatchWhatsAppReferralConverted(...args),
}));

import { db } from "@workspace/db";
import { runPostPaymentSideEffects } from "../services/checkout/post-booking.js";

// Each db.select() call pops the next result set off this queue. where() returns
// a thenable (for terminal `await … .where()`) that also exposes .limit() (for
// `… .where().limit(1)`); both resolve to the same popped result set.
let selectResults: object[][] = [];

function installSelectQueue(results: object[][]) {
  selectResults = [...results];
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const rows = selectResults.shift() ?? [];
      const p = Promise.resolve(rows) as Promise<object[]> & {
        limit: (n: number) => Promise<object[]>;
      };
      p.limit = vi.fn(() => Promise.resolve(rows));
      return p;
    });
    return chain;
  });
}

const ORDER = {
  id: "order-1",
  orderNumber: "VIS-PROD-202606-00001",
  tenantId: "tenant-1",
  storeId: "store-1",
  clientId: "client-1",
  customerName: "João Silva",
  customerEmail: "joao@example.com",
};

const STORE = {
  tenantId: "tenant-1",
  name: "Minha Loja",
  slug: "minha-loja",
  logo: "logo.png",
  customDomain: null,
};

const ADMIN_USER = { id: "user-001" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsurePortalAccount.mockResolvedValue(undefined);
  mockGenerateAndAssignReferralCode.mockResolvedValue("JOAO2026ABCDEFGH");
  mockWriteClientActivity.mockResolvedValue(undefined);
  mockApplyDeferredOrderCredits.mockResolvedValue({ conversionApplied: false });
  mockDispatchReferralConvertedEmail.mockResolvedValue(undefined);
  mockDispatchReferralTierUpgradeEmail.mockResolvedValue(undefined);
  mockDispatchReferralLoyaltyPointsEmail.mockResolvedValue(undefined);
  mockDispatchWhatsAppReferralConverted.mockResolvedValue(undefined);
  mockDetectAndNotifyTripOverlap.mockResolvedValue(undefined);
});

describe("runPostPaymentSideEffects", () => {
  it("mints a referral code AND provisions a portal account for a paid trip order", async () => {
    installSelectQueue([
      [ORDER], // order lookup
      [ADMIN_USER], // admin user for writeClientActivity
      [{ id: "res-1" }], // reservations for order
      [ADMIN_USER], // actor user for overlap-detection IIFE (fire-and-forget)
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockGenerateAndAssignReferralCode).toHaveBeenCalledTimes(1);
    expect(mockGenerateAndAssignReferralCode).toHaveBeenCalledWith(
      "client-1",
      "tenant-1",
      "JOAO2026ABCDEFGH",
      "JOOS", // "João Silva" → ASCII letters only → "JOOSILVA" → first 4
      expect.any(Number),
    );
    expect(mockEnsurePortalAccount).toHaveBeenCalledTimes(1);
    expect(mockEnsurePortalAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "joao@example.com",
        name: "João Silva",
        tenantId: "tenant-1",
        agencyName: "Minha Loja",
      }),
    );
  });

  it("mints a referral code but does NOT provision a portal account for a product-only order (no reservations)", async () => {
    installSelectQueue([
      [ORDER], // order lookup
      [ADMIN_USER], // admin user for writeClientActivity
      [], // no reservations → product-only → early return before store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockGenerateAndAssignReferralCode).toHaveBeenCalledTimes(1);
    expect(mockEnsurePortalAccount).not.toHaveBeenCalled();
  });

  it("does NOT mint a referral code when the order has no clientId, but still provisions a portal account when reservations exist", async () => {
    installSelectQueue([
      [{ ...ORDER, clientId: null }], // order without a linked client (no clientId block)
      [{ id: "res-1" }], // reservations exist
      [ADMIN_USER], // actor user for overlap-detection IIFE (fire-and-forget)
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockGenerateAndAssignReferralCode).not.toHaveBeenCalled();
    expect(mockWriteClientActivity).not.toHaveBeenCalled();
    expect(mockEnsurePortalAccount).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the order does not exist", async () => {
    installSelectQueue([[]]); // order lookup returns nothing

    await runPostPaymentSideEffects("missing-order");

    expect(mockGenerateAndAssignReferralCode).not.toHaveBeenCalled();
    expect(mockWriteClientActivity).not.toHaveBeenCalled();
    expect(mockEnsurePortalAccount).not.toHaveBeenCalled();
  });

  it("still provisions the portal account even if referral-code generation throws", async () => {
    mockGenerateAndAssignReferralCode.mockRejectedValueOnce(new Error("boom"));
    installSelectQueue([
      [ORDER], // order lookup
      [ADMIN_USER], // admin user for writeClientActivity
      [{ id: "res-1" }], // reservations
      [ADMIN_USER], // actor user for overlap-detection IIFE (fire-and-forget)
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockGenerateAndAssignReferralCode).toHaveBeenCalledTimes(1);
    expect(mockEnsurePortalAccount).toHaveBeenCalledTimes(1);
  });

  it("calls writeClientActivity with order_created after payment confirmation", async () => {
    installSelectQueue([
      [ORDER], // order lookup
      [ADMIN_USER], // admin user for writeClientActivity
      [{ id: "res-1" }], // reservations
      [ADMIN_USER], // actor user for overlap-detection IIFE (fire-and-forget)
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockWriteClientActivity).toHaveBeenCalledTimes(1);
    expect(mockWriteClientActivity).toHaveBeenCalledWith(
      "client-1",
      "order_created",
      expect.stringContaining("VIS-PROD-202606-00001"),
      "user-001",
      expect.objectContaining({
        orderNumber: "VIS-PROD-202606-00001",
        orderId: "order-1",
      }),
    );
  });

  it("does NOT call writeClientActivity when no active agency user is found for the tenant", async () => {
    installSelectQueue([
      [ORDER], // order lookup
      [], // admin user lookup → none found
      [{ id: "res-1" }], // reservations
      [], // actor user for overlap-detection IIFE → none found → detectAndNotifyTripOverlap not called
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockWriteClientActivity).not.toHaveBeenCalled();
    expect(mockEnsurePortalAccount).toHaveBeenCalledTimes(1);
  });

  it("still completes all other side effects even if writeClientActivity throws", async () => {
    mockWriteClientActivity.mockRejectedValueOnce(new Error("db error"));
    installSelectQueue([
      [ORDER], // order lookup
      [ADMIN_USER], // admin user for writeClientActivity
      [{ id: "res-1" }], // reservations
      [ADMIN_USER], // actor user for overlap-detection IIFE (fire-and-forget)
      [STORE], // store lookup
    ]);

    await runPostPaymentSideEffects("order-1");

    expect(mockEnsurePortalAccount).toHaveBeenCalledTimes(1);
  });

  describe("referral conversion emails", () => {
    it("dispatches dispatchReferralConvertedEmail (and not tier-upgrade or loyalty emails) when conversionApplied=true with no tier upgrade and no loyalty points", async () => {
      mockApplyDeferredOrderCredits.mockResolvedValueOnce({
        conversionApplied: true,
        referrerId: "ref-1",
        tenantId: "tenant-1",
        customerName: "João Silva",
        referralCode: null,
        conversion: {
          tierUpgraded: false,
          newTierLevel: null,
          newTierLabel: null,
          bonusMultiplier: null,
          loyaltyPointsGranted: 0,
          loyaltyPointsEmailEnabled: false,
          loyaltyCurrentBalance: 0,
        },
      });
      // order lookup returns nothing → early exit (only testing email dispatch)
      installSelectQueue([[]]);

      await runPostPaymentSideEffects("order-1");

      expect(mockDispatchReferralConvertedEmail).toHaveBeenCalledTimes(1);
      expect(mockDispatchReferralConvertedEmail).toHaveBeenCalledWith(
        "ref-1",
        "João Silva",
        "tenant-1",
      );
      expect(mockDispatchReferralTierUpgradeEmail).not.toHaveBeenCalled();
      expect(mockDispatchReferralLoyaltyPointsEmail).not.toHaveBeenCalled();
    });

    it("dispatches dispatchReferralTierUpgradeEmail when tierUpgraded=true", async () => {
      mockApplyDeferredOrderCredits.mockResolvedValueOnce({
        conversionApplied: true,
        referrerId: "ref-1",
        tenantId: "tenant-1",
        customerName: "Maria Souza",
        referralCode: null,
        conversion: {
          tierUpgraded: true,
          newTierLevel: 2,
          newTierLabel: "Gold",
          bonusMultiplier: 1.5,
          loyaltyPointsGranted: 0,
          loyaltyPointsEmailEnabled: false,
          loyaltyCurrentBalance: 0,
        },
      });
      installSelectQueue([[]]);

      await runPostPaymentSideEffects("order-1");

      expect(mockDispatchReferralConvertedEmail).toHaveBeenCalledTimes(1);
      expect(mockDispatchReferralTierUpgradeEmail).toHaveBeenCalledTimes(1);
      expect(mockDispatchReferralTierUpgradeEmail).toHaveBeenCalledWith(
        "ref-1",
        "tenant-1",
        2,
        "Gold",
        1.5,
      );
      expect(mockDispatchReferralLoyaltyPointsEmail).not.toHaveBeenCalled();
    });

    it("dispatches dispatchReferralLoyaltyPointsEmail when loyaltyPointsGranted > 0 and loyaltyPointsEmailEnabled=true", async () => {
      mockApplyDeferredOrderCredits.mockResolvedValueOnce({
        conversionApplied: true,
        referrerId: "ref-1",
        tenantId: "tenant-1",
        customerName: "Carlos Pereira",
        referralCode: null,
        conversion: {
          tierUpgraded: false,
          newTierLevel: null,
          newTierLabel: null,
          bonusMultiplier: null,
          loyaltyPointsGranted: 150,
          loyaltyPointsEmailEnabled: true,
          loyaltyCurrentBalance: 500,
        },
      });
      installSelectQueue([[]]);

      await runPostPaymentSideEffects("order-1");

      expect(mockDispatchReferralConvertedEmail).toHaveBeenCalledTimes(1);
      expect(mockDispatchReferralLoyaltyPointsEmail).toHaveBeenCalledTimes(1);
      expect(mockDispatchReferralLoyaltyPointsEmail).toHaveBeenCalledWith(
        "ref-1",
        "tenant-1",
        150,
        500,
      );
      expect(mockDispatchReferralTierUpgradeEmail).not.toHaveBeenCalled();
    });
  });
});
