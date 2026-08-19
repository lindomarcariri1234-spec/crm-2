/**
 * #35 — API error response format contract
 *
 * Verifies that the errorHandler middleware returns { error, code } JSON
 * for every AppError subclass (404, 403, 400, 401, 409) and falls back to
 * a safe 500 shape for unexpected errors.  No DB mocking is required — the
 * tests drive a minimal express app wired directly to the errorHandler.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../lib/errors.js";
import { errorHandler, requestId } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal express app — one route per error type
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  const noop = (..._args: unknown[]) => {};
  req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
  next();
}

function buildApp() {
  const app = express();
  app.use(requestId);
  app.use(stubLogger);

  app.get("/404", (_req, _res, next: express.NextFunction) =>
    next(new NotFoundError("Reserva não encontrada")));

  app.get("/403", (_req, _res, next: express.NextFunction) =>
    next(new ForbiddenError("Sem permissão", "FORBIDDEN_ROLE")));

  app.get("/400", (_req, _res, next: express.NextFunction) =>
    next(new ValidationError("Campo inválido", "INVALID_FIELD")));

  app.get("/401", (_req, _res, next: express.NextFunction) =>
    next(new AppError("Não autenticado", 401, "UNAUTHORIZED")));

  app.get("/409", (_req, _res, next: express.NextFunction) =>
    next(new ConflictError("Vaga já ocupada", "SEAT_TAKEN")));

  app.get("/500", (_req, _res, next: express.NextFunction) =>
    next(new Error("Falha inesperada do servidor")));

  app.use(errorHandler);
  return app;
}

const app = buildApp();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API error response format — { error, code } contract", () => {
  it("404 NotFoundError → status 404 with error and code fields", async () => {
    const res = await request(app).get("/404");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Reserva não encontrada", code: "NOT_FOUND" });
  });

  it("403 ForbiddenError → status 403 with custom code", async () => {
    const res = await request(app).get("/403");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "Sem permissão", code: "FORBIDDEN_ROLE" });
  });

  it("400 ValidationError → status 400 with INVALID_FIELD code", async () => {
    const res = await request(app).get("/400");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Campo inválido", code: "INVALID_FIELD" });
  });

  it("401 AppError → status 401 with UNAUTHORIZED code", async () => {
    const res = await request(app).get("/401");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Não autenticado", code: "UNAUTHORIZED" });
  });

  it("409 ConflictError → status 409 with SEAT_TAKEN code", async () => {
    const res = await request(app).get("/409");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "Vaga já ocupada", code: "SEAT_TAKEN" });
  });

  it("unknown Error → status 500 with INTERNAL_ERROR code", async () => {
    const res = await request(app).get("/500");
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });

  it("every error response includes a requestId field", async () => {
    const res = await request(app).get("/404");
    expect(res.body).toHaveProperty("requestId");
    expect(typeof res.body.requestId).toBe("string");
  });

  it("message field mirrors the error field in the response body", async () => {
    const res = await request(app).get("/400");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toBe(res.body.error);
  });

  it("error body is always application/json", async () => {
    const res = await request(app).get("/404");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
