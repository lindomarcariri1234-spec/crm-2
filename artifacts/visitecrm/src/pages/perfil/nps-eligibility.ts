import { RESERVATION_STATUS } from "@workspace/permissions";

export function isNpsReservationStatusEligible(status: string): boolean {
  return status === RESERVATION_STATUS.CONFIRMED || status === RESERVATION_STATUS.COMPLETED;
}
