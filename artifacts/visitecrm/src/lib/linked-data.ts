/** Supplemental relationships returned by tenant-scoped API responses. */
export type CanonicalPaymentState =
  | "pending"
  | "partially_paid"
  | "paid"
  | "failed"
  | "refunded"
  | "cancelled";

export interface FinancialSummary {
  source: "order" | "reservation";
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  depositRequested: number;
  paidAmount: number;
  amountRemaining: number;
  minimumRequired: number;
  reservationValid: boolean;
  states: {
    order: string | null;
    reservation: string | null;
    payment: CanonicalPaymentState;
  };
  diagnostics: {
    hasLegacyDivergence: boolean;
    issues: string[];
    legacy: {
      totalAmount: number | null;
      paidAmount: number | null;
      amountRemaining: number | null;
    } | null;
  };
}

export interface LinkedReservation {
  id: string;
  reservationNumber: string;
  tripId: string;
  status: string;
  totalValue: number | string;
  paidValue: number | string;
  balance: number | string;
  seats: string[];
  passengerCount: number;
  financialSummary?: FinancialSummary;
}

export interface LinkedOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  depositAmount: number | string | null;
  paidAmount: number | string;
  amountRemaining: number | string | null;
  paymentMethod: string | null;
  installments: number | null;
  financialSummary: FinancialSummary;
}

export interface LinkedReferral {
  id: string;
  code: string;
  status: string;
  referrerId: string;
  referrerName: string | null;
  discountAmount: number | string;
  bonusAmount: number | string;
}

export interface LinkedDeal {
  id: string;
  tripId: string | null;
  reservationId: string | null;
  stageId: string;
  status: string;
  source: string;
  value: number | string;
}

export interface LinkedData {
  financialSummary?: FinancialSummary;
  linkedOrder?: LinkedOrder | null;
  linkedReservations?: LinkedReservation[];
  linkedReferral?: LinkedReferral | null;
  linkedDeals?: LinkedDeal[];
}