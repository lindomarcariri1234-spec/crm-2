import { z } from "zod";
import {
  RESERVATION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  COMMISSION_STATUS,
  DEAL_STATUS,
  TRIP_STATUS,
  EXPENSE_STATUS,
  type ReservationStatus,
  type PaymentStatus,
  type PaymentType,
  type CommissionStatus,
  type DealStatus,
  type TripStatus,
  type ExpenseStatus,
} from "@workspace/permissions";
import { ValidationError } from "./errors";

function makeEnum<T extends string>(obj: Record<string, T>) {
  const values = Object.values(obj) as [T, ...T[]];
  return z.enum(values);
}

export const ReservationStatusSchema = makeEnum(RESERVATION_STATUS);
export const PaymentStatusSchema = makeEnum(PAYMENT_STATUS);
export const PaymentTypeSchema = makeEnum(PAYMENT_TYPE);
export const CommissionStatusSchema = makeEnum(COMMISSION_STATUS);
export const DealStatusSchema = makeEnum(DEAL_STATUS);
export const TripStatusSchema = makeEnum(TRIP_STATUS);
export const ExpenseStatusSchema = makeEnum(EXPENSE_STATUS);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ValidationError(`Invalid ${field}: ${String(value)}`, "INVALID_STATUS");
  }
  return r.data;
}

export const parseReservationStatus = (v: unknown): ReservationStatus =>
  parseOrThrow(ReservationStatusSchema, v, "reservation status");
export const parsePaymentStatus = (v: unknown): PaymentStatus =>
  parseOrThrow(PaymentStatusSchema, v, "payment status");
export const parsePaymentType = (v: unknown): PaymentType =>
  parseOrThrow(PaymentTypeSchema, v, "payment type");
export const parseCommissionStatus = (v: unknown): CommissionStatus =>
  parseOrThrow(CommissionStatusSchema, v, "commission status");
export const parseDealStatus = (v: unknown): DealStatus =>
  parseOrThrow(DealStatusSchema, v, "deal status");
export const parseTripStatus = (v: unknown): TripStatus =>
  parseOrThrow(TripStatusSchema, v, "trip status");
export const parseExpenseStatus = (v: unknown): ExpenseStatus =>
  parseOrThrow(ExpenseStatusSchema, v, "expense status");
