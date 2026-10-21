import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeRoutes = readFileSync(new URL("../routes/store.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");

describe("store product tenant association guards", () => {
  it("checks trip ownership on both product write paths", () => {
    const tripTenantGuard = /eq\(tripsTable\.tenantId, me\.tenantId\)/g;
    expect(storeRoutes.match(tripTenantGuard)).toHaveLength(2);
    expect(storeRoutes).toContain(
      'if (data.tripId !== undefined && data.tripId !== null) {',
    );
    expect(storeRoutes).toContain(
      'if (parsed.data.tripId !== undefined && parsed.data.tripId !== null) {',
    );
    expect(storeRoutes).toContain("tripId: z.string().nullable().optional()");
    expect(storeRoutes).toContain("await assertTripNotLinkedToAnotherStoreProduct(data.tripId)");
    expect(storeRoutes).toContain(
      "await assertTripNotLinkedToAnotherStoreProduct(parsed.data.tripId, existingProduct.id)",
    );
    expect(storeRoutes).toContain("STORE_TRIP_ALREADY_LINKED");
  });

  it("checks category ownership on both product write paths", () => {
    const categoryStoreGuard = /eq\(storeCategoriesTable\.storeId, store\.id\)/g;
    expect(storeRoutes.match(categoryStoreGuard)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(storeRoutes).toContain(
      'if (data.categoryId !== undefined) {',
    );
    expect(storeRoutes).toContain(
      'if (parsed.data.categoryId !== undefined) {',
    );
  });

  it("checks accommodation ownership on both product write paths", () => {
    expect(storeRoutes).toContain('if (data.accommodationId) {');
    expect(storeRoutes).toContain('if (parsed.data.accommodationId) {');
    const accommodationTenantGuard =
      /eq\(accommodationsTable\.id, (?:data|parsed\.data)\.accommodationId\),\s*eq\(accommodationsTable\.tenantId, me\.tenantId\)/g;
    expect(storeRoutes.match(accommodationTenantGuard)).toHaveLength(2);
  });

  it("scopes public product departure metadata to the store tenant", () => {
    expect(appSource).toContain("tenantId: storesTable.tenantId");
    expect(appSource).toContain("eq(tripsTable.tenantId, store.tenantId)");
    expect(appSource).not.toContain(
      "eq(tripsTable.tenantId, storesTable.tenantId)",
    );
  });
});