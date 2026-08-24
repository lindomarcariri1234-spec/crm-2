import { describe, expect, it } from "vitest";

import {
  getReferralCampaignRewardLabel,
  getReferralRewardLabel,
} from "../lib/referral-labels.js";

describe("referral reward labels", () => {
  it("presents legacy credit settings as cashback", () => {
    expect(getReferralRewardLabel("credit")).toBe("Cashback");
  });

  it("preserves the money payout label and falls back safely for legacy data", () => {
    expect(getReferralRewardLabel("cash")).toBe("Dinheiro");
    expect(getReferralRewardLabel(null)).toBe("Bônus");
    expect(getReferralRewardLabel("unknown")).toBe("Bônus");
  });

  it("presents campaigns without a free reward as sem bônus", () => {
    expect(getReferralCampaignRewardLabel("no_reward")).toBe("Sem Bônus");
  });
});