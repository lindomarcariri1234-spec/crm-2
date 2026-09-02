import { describe, expect, it } from "vitest";
import { brazilMonthPeriod, maskRankingName, rankingMetadata } from "./ranking-contract";

describe("ranking contract", () => {
  it("uses the Brazil month at the UTC month boundary", () => {
    const period = brazilMonthPeriod(new Date("2024-03-01T02:59:59.999Z"));
    expect(period.key).toBe("2024-02");
    expect(period.start.toISOString()).toBe("2024-02-01T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2024-03-01T03:00:00.000Z");
  });

  it("publishes opt-in, masking, exclusion and deterministic tie rules", () => {
    const publicReferral = rankingMetadata("referral", "public", brazilMonthPeriod(new Date("2024-04-15T12:00:00Z")));
    const adminTraveler = rankingMetadata("traveler", "admin", brazilMonthPeriod(new Date("2024-04-15T12:00:00Z")));

    expect(publicReferral.eligibilitySummary).toMatchObject({
      eligibleStatuses: ["completed", "converted"],
      excludedStatuses: ["reversed"],
      optInRequired: true,
      namesMasked: true,
    });
    expect(adminTraveler.eligibilitySummary).toMatchObject({
      eligibleStatuses: ["completed"],
      excludedStatuses: ["cancelled", "refunded"],
      optInRequired: false,
      namesMasked: false,
    });
    expect(publicReferral.tieBreakers).toEqual(["count DESC", "clientName ASC", "clientId ASC"]);
    expect(maskRankingName("Ana Maria Silva")).toBe("Ana S.");
  });
});