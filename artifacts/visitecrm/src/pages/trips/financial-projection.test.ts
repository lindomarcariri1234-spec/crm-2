import { describe, expect, it } from "vitest";
import { calculateOccupancyProjections, OCCUPANCY_SCENARIOS } from "./financial-projection";

const exampleTrip = {
  capacity: 50,
  ticketPrice: 100,
  fixedCostAmounts: [1000],
  variableCostPerPassengerAmounts: [10],
};

describe("calculateOccupancyProjections", () => {
  it("calculates all requested occupancy scenarios from the same passenger count", () => {
    const projections = calculateOccupancyProjections(exampleTrip);

    expect(projections.map(({ occupancyPercent }) => occupancyPercent)).toEqual(
      OCCUPANCY_SCENARIOS,
    );
    expect(projections.map(({ passengers }) => passengers)).toEqual([25, 30, 35, 40, 45, 50]);
  });

  it("calculates the 80% baseline with variable costs based on 40 passengers", () => {
    const projection = calculateOccupancyProjections(exampleTrip).find(
      ({ occupancyPercent }) => occupancyPercent === 80,
    );

    expect(projection).toMatchObject({
      passengers: 40,
      grossRevenue: 4000,
      fixedCosts: 1000,
      variableCosts: 400,
      operatingCosts: 1400,
      averageCostPerPassenger: 35,
      estimatedProfit: 2600,
      marginPercent: 65,
    });
  });

  it("keeps the full-capacity scenario internally consistent", () => {
    const projection = calculateOccupancyProjections(exampleTrip).find(
      ({ occupancyPercent }) => occupancyPercent === 100,
    );

    expect(projection).toMatchObject({
      passengers: 50,
      grossRevenue: 5000,
      variableCosts: 500,
      operatingCosts: 1500,
      averageCostPerPassenger: 30,
      estimatedProfit: 3500,
      marginPercent: 70,
    });
  });

  it("uses whole passengers and avoids undefined average costs or margins", () => {
    const projection = calculateOccupancyProjections({
      capacity: 1,
      ticketPrice: 100,
      fixedCostAmounts: [10],
      variableCostPerPassengerAmounts: [5],
    })[0];
    const zeroCapacityProjection = calculateOccupancyProjections({
      ...exampleTrip,
      capacity: 0,
    })[0];

    expect(projection.passengers).toBe(0);
    expect(projection.averageCostPerPassenger).toBeNull();
    expect(projection.marginPercent).toBeNull();
    expect(zeroCapacityProjection.estimatedProfit).toBe(-1000);
  });
});