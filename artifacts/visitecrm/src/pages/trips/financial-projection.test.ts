import { describe, expect, it } from "vitest";
import { calculateOccupancyProjections, OCCUPANCY_SCENARIOS } from "./financial-projection";

const exampleTrip = {
  capacity: 50,
  ticketPrices: { adult: 100, child: 60, senior: 80 },
  passengerMixWeights: { adult: 1, child: 0, senior: 0 },
  fixedCostAmount: 1000,
  variableCostPerPassengerAmount: 10,
};

describe("calculateOccupancyProjections", () => {
  it("builds every requested scenario, with an 80% base and floor passenger counts", () => {
    const projections = calculateOccupancyProjections({ ...exampleTrip, capacity: 7 });
    expect(projections.map(({ occupancyPercent }) => occupancyPercent)).toEqual(OCCUPANCY_SCENARIOS);
    expect(projections.map(({ passengers }) => passengers)).toEqual([3, 4, 4, 5, 6, 7]);
    expect(projections.find(({ occupancyPercent }) => occupancyPercent === 80)?.passengers).toBe(5);
  });

  it("uses fare mix weights across adult, child, and senior fares", () => {
    const projection = calculateOccupancyProjections({
      ...exampleTrip,
      capacity: 10,
      passengerMixWeights: { adult: 50, child: 30, senior: 20 },
    }).find(({ occupancyPercent }) => occupancyPercent === 80);

    expect(projection).toMatchObject({
      passengers: 8,
      passengerMix: { adult: 4, child: 2, senior: 2 },
      grossRevenue: 680,
    });
  });

  it("allocates whole passengers deterministically, assigning tied remainders adult-first", () => {
    const projections = calculateOccupancyProjections({
      ...exampleTrip,
      capacity: 5,
      passengerMixWeights: { adult: 1, child: 1, senior: 1 },
    });
    expect(projections[0].passengerMix).toEqual({ adult: 1, child: 1, senior: 0 });
    expect(projections[0].passengers).toBe(
      projections[0].passengerMix.adult + projections[0].passengerMix.child + projections[0].passengerMix.senior,
    );
  });

  it("defaults to adults when all passenger mix weights are zero", () => {
    const [projection] = calculateOccupancyProjections({
      ...exampleTrip,
      capacity: 8,
      passengerMixWeights: { adult: 0, child: 0, senior: 0 },
    });
    expect(projection.passengerMix).toEqual({ adult: 4, child: 0, senior: 0 });
  });

  it("rounds ticket and cost inputs to integer cents before projecting totals", () => {
    const projection = calculateOccupancyProjections({
      capacity: 1,
      ticketPrices: { adult: 12.345, child: 0, senior: 0 },
      passengerMixWeights: { adult: 1, child: 0, senior: 0 },
      fixedCostAmount: 0.105,
      variableCostPerPassengerAmount: 1.005,
    }).at(-1);

    expect(projection).toMatchObject({
      passengers: 1,
      grossRevenue: 12.35,
      fixedCosts: 0.11,
      variableCosts: 1.01,
      operatingCosts: 1.12,
      estimatedProfit: 11.23,
    });
  });

  it("keeps fixed costs unchanged and scales variable costs by scenario passengers", () => {
    const projections = calculateOccupancyProjections(exampleTrip);
    expect(projections.find(({ occupancyPercent }) => occupancyPercent === 80)).toMatchObject({
      passengers: 40,
      grossRevenue: 4000,
      fixedCosts: 1000,
      variableCosts: 400,
      operatingCosts: 1400,
      averageCostPerPassenger: 35,
      estimatedProfit: 2600,
      marginPercent: 65,
    });
    expect(projections.at(-1)).toMatchObject({
      passengers: 50,
      fixedCosts: 1000,
      variableCosts: 500,
      operatingCosts: 1500,
    });
  });

  it("handles zero capacity without undefined costs or margins", () => {
    const [projection] = calculateOccupancyProjections({ ...exampleTrip, capacity: 0 });
    expect(projection).toMatchObject({
      passengers: 0,
      passengerMix: { adult: 0, child: 0, senior: 0 },
      grossRevenue: 0,
      fixedCosts: 1000,
      variableCosts: 0,
      averageCostPerPassenger: null,
      estimatedProfit: -1000,
      marginPercent: null,
    });
  });
});