/**
 * Shared drizzle-orm vi.mock factory for endpoint-level test suites.
 *
 * WHY THIS EXISTS
 * ---------------
 * Endpoint tests that exercise real Express route handlers must stub out
 * `drizzle-orm` so that query builder calls (eq, and, notInArray, …) return
 * harmless sentinel strings instead of trying to build real SQL.  When a route
 * starts using a new drizzle-orm operator and that operator is absent from the
 * mock, the call throws `TypeError: <operator> is not a function`, which the
 * Express error handler catches → HTTP 500.  The test then fails with "expected
 * 201 to be 500" — a misleading error that hides the real root cause.
 *
 * Keeping the mock in a single place means:
 *   1. One file to update when a new drizzle-orm operator is added to a route.
 *   2. The `satisfies` check on DRIZZLE_MOCK_KEYS catches typos against the
 *      real drizzle-orm exports at build time — if you misspell an operator
 *      name TypeScript reports an error here, not deep inside a test.
 *
 * HOW TO ADD A NEW OPERATOR OR AGGREGATION HELPER
 * --------------------------
 * 1. Add the name to DRIZZLE_MOCK_KEYS below.  TypeScript validates the name
 *    against drizzle-orm's actual exports.
 * 2. Add the matching vi.fn() entry to the returned object in makeDrizzleOrmMock.
 * 3. Do not add one-off extras in individual test files.  Every test file that
 *    uses this helper automatically picks up the shared mock.
 *
 * HOW TO USE IN A TEST FILE
 * --------------------------
 * Because vi.mock() factories are hoisted, use an async factory with a dynamic
 * import so Vitest resolves the helper at mock-evaluation time:
 *
 *   vi.mock("drizzle-orm", async () => {
 *     const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
 *     return makeDrizzleOrmMock();
 *   });
 */

import { vi } from "vitest";
import type * as drizzleOrm from "drizzle-orm";

/**
 * Every key listed here is validated against drizzle-orm's actual exports via
 * `satisfies`.  Misspelled or removed operator names produce a TS error at this
 * declaration — not buried inside a failing test.
 *
 * When a route starts using a new drizzle-orm operator, add it here AND in
 * makeDrizzleOrmMock below.
 */
const DRIZZLE_MOCK_KEYS = [
  "eq",
  "ne",
  "and",
  "or",
  "not",
  "inArray",
  "notInArray",
  "isNull",
  "isNotNull",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "notBetween",
  "like",
  "ilike",
  "notIlike",
  "desc",
  "asc",
  "sql",
  "count",
  "max",
  "min",
  "avg",
  "sum",
  "getTableColumns",
] as const satisfies readonly (keyof typeof drizzleOrm)[];

// Reference prevents the const from being tree-shaken away before tsc evaluates
// the satisfies constraint.
void (DRIZZLE_MOCK_KEYS as unknown);

/**
 * Returns a fresh mock of drizzle-orm operators for use in vi.mock() factories.
 *
 * Return type is a plain Record so that the sentinel values (strings, arrays)
 * are accepted by TypeScript without clashing with Drizzle's SQL type signatures.
 * Name safety is enforced separately via the DRIZZLE_MOCK_KEYS satisfies check.
 */
export function makeDrizzleOrmMock(): Record<string, unknown> {
  return {
    eq: vi.fn(() => "eq"),
    ne: vi.fn(() => "ne"),
    and: vi.fn((...a: unknown[]) => a),
    or: vi.fn((...a: unknown[]) => a),
    not: vi.fn(() => "not"),
    inArray: vi.fn(() => "inArray"),
    notInArray: vi.fn(() => "notInArray"),
    isNull: vi.fn(() => "isNull"),
    isNotNull: vi.fn(() => "isNotNull"),
    gt: vi.fn(() => "gt"),
    gte: vi.fn(() => "gte"),
    lt: vi.fn(() => "lt"),
    lte: vi.fn(() => "lte"),
    between: vi.fn(() => "between"),
    notBetween: vi.fn(() => "notBetween"),
    like: vi.fn(() => "like"),
    ilike: vi.fn(() => "ilike"),
    notIlike: vi.fn(() => "notIlike"),
    desc: vi.fn(() => "desc"),
    asc: vi.fn(() => "asc"),
    sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn(() => "sql.raw") }),
    count: vi.fn(() => "count"),
    max: vi.fn(() => "max"),
    min: vi.fn(() => "min"),
    avg: vi.fn(() => "avg"),
    sum: vi.fn(() => "sum"),
    getTableColumns: vi.fn(() => ({})),
  };
}
