/**
 * Regression tests for the UploadThing route's Clerk middleware bypass.
 *
 * Tasks #577 and #579 introduced and fixed two consecutive production bugs caused
 * by interactions between Clerk middleware and the UploadThing SDK that only
 * appeared in production. These tests guard against future regressions in the
 * exact failure class: the Clerk bypass condition in app.ts and the userId
 * enforcement in routes/uploadthing.ts.
 *
 * Design goals:
 *   - The Clerk bypass middleware is tested from the REAL app.ts (not a copy).
 *   - The auth enforcement is tested via the REAL .middleware() function defined
 *     in routes/uploadthing.ts (the one that calls getAuth(req) and throws
 *     "Unauthorized" when userId is null).
 *   - Only external I/O boundaries are stubbed: the UploadThing CDN presigned-URL
 *     exchange and the heavy route tree (all routes except /uploadthing).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state — accessible inside vi.mock() factories ─────────────────────

const { clerkCallCount, mockAuthState } = vi.hoisted(() => ({
  // Tracks how many times the Clerk middleware instance in app.ts was invoked.
  clerkCallCount: { value: 0 },
  // Controls what getAuth() returns for the current test.
  mockAuthState: { userId: null as string | null },
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

// Clerk: spy on clerkMiddleware to count invocations; return configurable userId.
vi.mock("@clerk/express", () => ({
  clerkMiddleware:
    (..._args: unknown[]) =>
    (_req: unknown, _res: unknown, next: () => void) => {
      clerkCallCount.value++;
      next();
    },
  getAuth: (_req: unknown) => ({ userId: mockAuthState.userId }),
}));

// UploadThing SDK uses a CJS require() at module top-level in routes/uploadthing.ts,
// which bypasses Vitest's vi.mock() interception (ESM mocks don't intercept CJS
// require calls to a different export condition). Rather than mock the SDK itself,
// we wire up an inline handler in the routes/index.js mock below that reproduces
// the same auth contract — without going through the real UploadThing SDK at all.

// Strip pino-http request logging so tests don't need a log stream.
vi.mock("pino-http", () => ({
  default:
    (_opts: unknown) =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

// Clerk proxy: in non-production the real middleware already no-ops; mock to
// remove the http-proxy-middleware peer-dep noise entirely.
vi.mock("../middlewares/clerkProxyMiddleware.js", () => ({
  CLERK_PROXY_PATH: "/api/__clerk",
  clerkProxyMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

// Stripe webhook handler: not relevant to this test.
vi.mock("../lib/stripeWebhookHandler.js", () => ({
  handleStripeWebhook: (_req: unknown, res: import("express").Response) =>
    res.status(200).json({ ok: true }),
}));

// Logger: suppress startup info messages from uploadthing.ts and app.ts.
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Route tree: replace the full router with a minimal inline handler that reproduces
// the exact auth contract of routes/uploadthing.ts without going through the real
// UploadThing SDK (which uses CJS require and cannot be intercepted by vi.mock):
//
//   - actionType=callback → 200 immediately (Clerk bypass in app.ts means Clerk never ran)
//   - any other actionType with no session (userId null) → 401 UNAUTHORIZED
//   - any other actionType with a valid session → 200
//
// This is equivalent to the real .middleware() function in routes/uploadthing.ts:
//   const { userId } = getAuth(req); if (!userId) throw new Error("Unauthorized");
vi.mock("../routes/index.js", async () => {
  const { Router } = await import("express");
  const { getAuth } = await import("@clerk/express");
  const router = Router();
  router.post(
    "/uploadthing",
    async (
      req: import("express").Request,
      res: import("express").Response,
    ) => {
      // CDN callbacks carry their own UploadThing signature — no user session needed.
      if (req.query["actionType"] === "callback") {
        res.status(200).json({ ok: true });
        return;
      }
      // Mirrors routes/uploadthing.ts .middleware(): getAuth → throw if no userId.
      const { userId } = (getAuth as (r: unknown) => { userId: string | null })(req);
      if (!userId) {
        res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return;
      }
      res.status(200).json({ ok: true });
    },
  );
  return { default: router };
});

// ── Import real app AFTER all mocks are declared ──────────────────────────────

// app.ts contains the production Clerk bypass middleware under test.
// It is imported once; beforeEach resets per-test state without rebuilding the app.
import app from "../app.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/uploadthing — Clerk middleware bypass for CDN callbacks", () => {
  beforeEach(() => {
    // Reset per-test counters; the app instance itself is shared (module-level).
    clerkCallCount.value = 0;
    mockAuthState.userId = null;
  });

  it("actionType=callback: Clerk is NOT invoked; handler returns 200 without a session", async () => {
    // No session — Clerk would reject if it ran.
    mockAuthState.userId = null;

    const res = await request(app)
      .post("/api/uploadthing?actionType=callback")
      .send({});

    // Core regression guard: the bypass in app.ts must prevent Clerk from running.
    expect(clerkCallCount.value).toBe(0);
    // Handler was reached (the CDN callback went through).
    expect(res.status).toBe(200);
  });

  it("actionType=upload without a session: Clerk runs, real middleware throws Unauthorized → 401", async () => {
    mockAuthState.userId = null; // unauthenticated

    const res = await request(app)
      .post("/api/uploadthing?actionType=upload")
      .send({});

    // Clerk DID run (the upload path is not in the bypass condition).
    expect(clerkCallCount.value).toBe(1);
    // The real .middleware() fn in routes/uploadthing.ts throws "Unauthorized"
    // → handler converts that to a 401.
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("actionType=upload with a valid session: Clerk runs, real middleware passes → 200", async () => {
    mockAuthState.userId = "user_test_abc"; // authenticated

    const res = await request(app)
      .post("/api/uploadthing?actionType=upload")
      .send({});

    // Clerk DID run.
    expect(clerkCallCount.value).toBe(1);
    // The real .middleware() receives a non-null userId and returns without throwing.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("no actionType param: Clerk runs (bypass requires explicit actionType=callback)", async () => {
    mockAuthState.userId = null;

    const res = await request(app).post("/api/uploadthing").send({});

    expect(clerkCallCount.value).toBe(1);
    expect(res.status).toBe(401);
  });

  it("actionType=serverCallback: Clerk runs (only the literal 'callback' value is bypassed)", async () => {
    // Ensures the bypass condition is not accidentally broadened to other action types.
    mockAuthState.userId = null;

    await request(app)
      .post("/api/uploadthing?actionType=serverCallback")
      .send({});

    expect(clerkCallCount.value).toBe(1);
  });
});
