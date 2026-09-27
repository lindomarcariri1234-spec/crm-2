import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeRoutes = readFileSync(new URL("../routes/store.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");

describe("store product tenant association guards", () => {
  it("checks trip ownership on both product write paths", () => {
    const tripTenantGuard = /eq\(tripsTable\.tenantId, me\.tenantId\)/g;
    expect(storeRoutes.match(tripTenantGuard)).toHaveLength(2);
    expect(storeRoutes).toContain(
      'if (data.tripId !== undefined) {',
    );
    expect(storeRoutes).toContain(
      'if (parsed.data.tripId !== undefined) {',
    );
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

  it("scopes public product departure metadata to the store tenant", () => {
    expect(appSource).toContain("tenantId: storesTable.tenantId");
    expect(appSource).toContain("eq(tripsTable.tenantId, store.tenantId)");
    expect(appSource).not.toContain(
      "eq(tripsTable.tenantId, storesTable.tenantId)",
    );
  });
});