/** Supplemental relationships returned by tenant-scoped API responses. */
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
  linkedOrder?: LinkedOrder | null;
  linkedReservations?: LinkedReservation[];
  linkedReferral?: LinkedReferral | null;
  linkedDeals?: LinkedDeal[];
}