import { EXPENSE_STATUS, PAYMENT_STATUS, type ExpenseStatus, type PaymentStatus } from "@workspace/permissions";
import { ConflictError } from "../lib/errors";

const syncableStatuses = new Set<string>([
  EXPENSE_STATUS.PENDING,
  EXPENSE_STATUS.OVERDUE,
  EXPENSE_STATUS.PAID,
]);

export function toPayableStatus(status: string): PaymentStatus {
  if (!syncableStatuses.has(status)) {
    throw new ConflictError(
      "Desvincule a conta a pagar antes de usar este status.",
      "OPERATIONAL_COST_STATUS_UNSUPPORTED",
    );
  }
  return status as PaymentStatus;
}

export function toOperationalCostStatus(status: string): ExpenseStatus {
  if (!syncableStatuses.has(status)) {
    throw new ConflictError(
      "Desvincule o custo operacional antes de usar este status.",
      "OPERATIONAL_COST_STATUS_UNSUPPORTED",
    );
  }
  return status as ExpenseStatus;
}

export function operationalCostAmountsMatch(costAmount: string | number, payableAmount: string | number): boolean {
  const costCents = Math.round(Number(costAmount) * 100);
  const payableCents = Math.round(Number(payableAmount) * 100);
  return Number.isFinite(costCents) && Number.isFinite(payableCents) && costCents === payableCents;
}

export function assertPayableMatchesOperationalCost(input: {
  costAmount: string | number;
  costStatus: string;
  payable: { type: string; status: string; amount: string | number };
}): void {
  if (input.payable.type !== "payable") {
    throw new ConflictError("Selecione um lançamento do tipo a pagar.", "PAYMENT_NOT_PAYABLE");
  }
  const costStatus = toPayableStatus(input.costStatus);
  const payableStatus = toPayableStatus(input.payable.status);
  if (!operationalCostAmountsMatch(input.costAmount, input.payable.amount) || costStatus !== payableStatus) {
    throw new ConflictError(
      "O valor e o status precisam coincidir para vincular os registros.",
      "OPERATIONAL_COST_PAYABLE_MISMATCH",
    );
  }
}