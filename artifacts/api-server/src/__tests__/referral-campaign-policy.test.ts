import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResult = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {},
  referralCampaignsTable: {
    id: "id", tenantId: "tenant_id", bonusType: "bonus_type", bonusValue: "bonus_value",
    eligibleStoreProductIds: "eligible_products", eligibleTierLevels: "eligible_tiers",
    startsAt: "starts_at", endsAt: "ends_at",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...parts) => parts),
  desc: vi.fn((value) => value),
  eq: vi.fn((column, value) => [column, value]),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

import { applyActiveCampaignBonus } from "../lib/referral-campaigns.js";

function queryRunner() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => selectResult() }),
        }),
      }),
    }),
  } as never;
}

describe("referral campaign policy", () => {
  beforeEach(() => selectResult.mockReset());

  it("applies a campaign only for eligible products and tiers", async () => {
    selectResult.mockResolvedValue([{
      id: "campaign-1", bonusType: "fixed_bonus", bonusValue: "15",
      eligibleStoreProductIds: ["product-1"], eligibleTierLevels: ["gold"],
    }]);
    await expect(applyActiveCampaignBonus(queryRunner(), "tenant-a", 10, new Date(), {
      productIds: ["product-1"], referrerTierLevel: "gold",
    })).resolves.toMatchObject({ adjustedBase: 0, fixedExtra: 15, rewardOutcome: "fixed_bonus" });
    await expect(applyActiveCampaignBonus(queryRunner(), "tenant-a", 10, new Date(), {
      productIds: ["product-2"], referrerTierLevel: "gold",
    })).resolves.toMatchObject({ adjustedBase: 10, fixedExtra: 0, rewardOutcome: "base" });
  });

  it("makes no-reward campaigns explicit", async () => {
    selectResult.mockResolvedValue([{
      id: "campaign-2", bonusType: "no_reward", bonusValue: "0",
      eligibleStoreProductIds: [], eligibleTierLevels: [],
    }]);
    await expect(applyActiveCampaignBonus(queryRunner(), "tenant-a", 10))
      .resolves.toMatchObject({ adjustedBase: 0, fixedExtra: 0, rewardOutcome: "no_reward" });
  });
});