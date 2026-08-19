import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../lib/errors.js";

describe("AppError", () => {
  it("sets message, statusCode, code and isOperational", () => {
    const err = new AppError("algo deu errado", 422, "MY_CODE");
    expect(err.message).toBe("algo deu errado");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("MY_CODE");
    expect(err.isOperational).toBe(true);
  });

  it("uses defaults when only message is passed", () => {
    const err = new AppError("fail");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
  });

  it("stores extra metadata when provided", () => {
    const err = new AppError("fail", 400, "CODE", { field: "email" });
    expect(err.extra).toEqual({ field: "email" });
  });

  it("is an instance of Error", () => {
    expect(new AppError("x")).toBeInstanceOf(Error);
  });
});

describe("NotFoundError", () => {
  it("has statusCode 404 and default code NOT_FOUND", () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("accepts a custom message", () => {
    const err = new NotFoundError("Reserva não encontrada");
    expect(err.message).toBe("Reserva não encontrada");
  });

  it("is an instance of AppError", () => {
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });
});

describe("ConflictError", () => {
  it("has statusCode 409", () => {
    const err = new ConflictError("Já existe");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("accepts a custom code", () => {
    const err = new ConflictError("duplicado", "SEAT_TAKEN");
    expect(err.code).toBe("SEAT_TAKEN");
  });

  it("is an instance of AppError", () => {
    expect(new ConflictError("x")).toBeInstanceOf(AppError);
  });
});

describe("ForbiddenError", () => {
  it("has statusCode 403 and default code FORBIDDEN", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("accepts a custom message and code", () => {
    const err = new ForbiddenError("Sem permissão", "NO_ACCESS");
    expect(err.message).toBe("Sem permissão");
    expect(err.code).toBe("NO_ACCESS");
  });
});

describe("ValidationError", () => {
  it("has statusCode 400 and default code VALIDATION_ERROR", () => {
    const err = new ValidationError("campo inválido");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("passes extra data through", () => {
    const err = new ValidationError("bad", "VALIDATION_ERROR", { valid: false });
    expect(err.extra).toEqual({ valid: false });
  });

  it("is an instance of AppError", () => {
    expect(new ValidationError("x")).toBeInstanceOf(AppError);
  });
});
