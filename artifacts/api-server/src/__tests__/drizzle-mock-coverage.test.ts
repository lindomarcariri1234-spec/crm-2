/**
 * drizzle-mock-coverage.test.ts
 *
 * Verifies that `helpers/drizzle-mock.ts` — the shared factory used by every
 * mocked endpoint test — provides every drizzle-orm operator the codebase
 * calls, including operators that were historically absent from per-file inline
 * mocks and would silently produce a 500 instead of the expected 4xx.
 *
 * HOW THIS DIFFERS FROM THE SHARED HELPER
 * ----------------------------------------
 * `helpers/drizzle-mock.ts` is imported by test files that exercise real
 * Express route handlers and therefore need drizzle-orm mocked.  This file
 * only validates that the factory produces callable stubs for every operator —
 * it does not test any route handler.
 *
 * The vi.mock here is intentionally per-file (not a global setupFiles entry)
 * so that real-drizzle integration tests (e.g. checkout-race-condition-db-
 * integration.test.ts) are never affected by this stub.
 *
 * OPERATORS CONFIRMED BELOW (subset that were absent from the old inline mock
 * in checkout-race-condition.test.ts before it was migrated):
 *   notInArray, not, gt, gte, lt, lte, between, notBetween, like, notIlike, max
 */

import { describe, it, expect } from "vitest";
import { vi } from "vitest";

// Per-file mock — intentionally NOT a global setupFiles entry.
// Real-drizzle tests (db-integration, alerts, SQL-rendering) must keep
// access to the actual module; a suite-wide override would break them.
vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

import {
  eq,
  ne,
  and,
  or,
  not,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  gt,
  gte,
  lt,
  lte,
  between,
  notBetween,
  like,
  ilike,
  notIlike,
  desc,
  asc,
  sql,
  max,
} from "drizzle-orm";

describe("shared drizzle-orm mock coverage (helpers/drizzle-mock.ts)", () => {
  it("every comparison operator is a callable vi.fn()", () => {
    expect(typeof eq).toBe("function");
    expect(typeof ne).toBe("function");
    expect(typeof gt).toBe("function");
    expect(typeof gte).toBe("function");
    expect(typeof lt).toBe("function");
    expect(typeof lte).toBe("function");
    expect(typeof isNull).toBe("function");
    expect(typeof isNotNull).toBe("function");
  });

  it("every logical / set operator is a callable vi.fn()", () => {
    expect(typeof and).toBe("function");
    expect(typeof or).toBe("function");
    expect(typeof not).toBe("function");
    expect(typeof inArray).toBe("function");
    expect(typeof notInArray).toBe("function");
    expect(typeof between).toBe("function");
    expect(typeof notBetween).toBe("function");
  });

  it("every string / ordering / aggregation operator is a callable vi.fn()", () => {
    expect(typeof like).toBe("function");
    expect(typeof ilike).toBe("function");
    expect(typeof notIlike).toBe("function");
    expect(typeof desc).toBe("function");
    expect(typeof asc).toBe("function");
    expect(typeof max).toBe("function");
  });

  it("sql is a callable vi.fn() with a .raw sub-mock", () => {
    expect(typeof sql).toBe("function");
    expect(typeof sql.raw).toBe("function");
  });

  // Operators absent from the old checkout-race-condition.test.ts inline mock
  // — if any of these throw, the factory is missing that operator.
  it("notInArray does not throw (was absent from old inline mock)", () => {
    expect(() => notInArray(undefined as never, [])).not.toThrow();
  });

  it("not does not throw (was absent from old inline mock)", () => {
    expect(() => not(undefined as never)).not.toThrow();
  });

  it("gt does not throw (was absent from old inline mock)", () => {
    expect(() => gt(undefined as never, undefined as never)).not.toThrow();
  });

  it("between does not throw (was absent from old inline mock)", () => {
    expect(() =>
      between(undefined as never, undefined as never, undefined as never),
    ).not.toThrow();
  });
});
