import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}

export function requestId(req: Request, _res: Response, next: NextFunction): void {
  if (!req.id) {
    req.id = crypto.randomUUID();
  }
  next();
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const rid = req.id ?? "unknown";
  const tenantId = req.tenantId ?? "unknown";
  const userId = req.userId ?? "unknown";

  if (err instanceof AppError && err.isOperational) {
    req.log?.warn(
      { requestId: rid, tenantId, userId, code: err.code, statusCode: err.statusCode },
      err.message,
    );

    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      message: err.message,
      requestId: rid,
      ...err.extra,
    });
    return;
  }

  req.log?.error(
    { err, requestId: rid, tenantId, userId },
    "Unexpected server error",
  );

  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    requestId: rid,
  });
}
