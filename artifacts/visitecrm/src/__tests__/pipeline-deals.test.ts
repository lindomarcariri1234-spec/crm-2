import { describe, expect, it } from "vitest";
import { mergePipelineDeals } from "../pages/pipeline-deals.js";

describe("mergePipelineDeals", () => {
  it("keeps confirmed-reservation deals visible with open deals", () => {
    const openDeal = { id: "open-deal", status: "open" };
    const confirmedReservationDeal = { id: "deposit-deal", status: "won" };

    expect(mergePipelineDeals([openDeal], [confirmedReservationDeal])).toEqual([
      openDeal,
      confirmedReservationDeal,
    ]);
  });

  it("does not render the same deal card twice while query caches refresh", () => {
    const deal = { id: "deposit-deal", status: "won" };

    expect(mergePipelineDeals([deal], [deal])).toEqual([deal]);
  });
});