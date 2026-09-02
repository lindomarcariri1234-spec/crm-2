import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, storesTable: {}, storeCategoriesTable: {}, storeProductsTable: {}, storeOrdersTable: {}, storeOrderItemsTable: {}, storeCouponsTable: {}, storeReviewsTable: {}, pipelineStagesTable: {}, dealsTable: {}, reservationsTable: {}, referralsTable: {}, partnerProductsTable: {}, priceAlertSubscriptionsTable: {} }));
vi.mock("../lib/tenant.js", () => ({ requireAuth: vi.fn(), ADMIN_ROLES: [] }));
import { safeAdminOrder } from "../routes/store.js";

describe("safeAdminOrder", () => {
  it("redacts checkout authorization and deferred referral internals", () => {
    expect(safeAdminOrder({ id: "o1", paymentToken: "secret", pendingReferral: { referralId: "r1" }, status: "paid" }))
      .toEqual({ id: "o1", status: "paid" });
  });
});