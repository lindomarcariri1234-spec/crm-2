import { describe, expect, it } from "vitest";
import {
  getStorefrontInitialPipelineStage,
  STOREFRONT_INITIAL_PIPELINE_STAGE,
} from "../services/checkout/storefront-pipeline.js";

describe("storefront reservation pipeline stage", () => {
  it("starts a reservation without a deposit in Vitrine", () => {
    expect(getStorefrontInitialPipelineStage(false)).toBe("Vitrine");
    expect(getStorefrontInitialPipelineStage(false)).toBe(STOREFRONT_INITIAL_PIPELINE_STAGE);
  });

  it("also starts a deposit reservation in Vitrine", () => {
    expect(getStorefrontInitialPipelineStage(true)).toBe("Vitrine");
    expect(getStorefrontInitialPipelineStage(true)).toBe(STOREFRONT_INITIAL_PIPELINE_STAGE);
  });
});