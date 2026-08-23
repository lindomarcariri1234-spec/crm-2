export type PassengerExportFinancialValues = [string, string, string];

export function getPassengerExportFinancialValues(
  reservationId: string,
  totalValue: number,
  discountTotal: number,
  emittedReservationIds: Set<string>,
): PassengerExportFinancialValues {
  if (emittedReservationIds.has(reservationId)) {
    return ["", "", ""];
  }

  emittedReservationIds.add(reservationId);
  return [
    totalValue.toFixed(2),
    (totalValue + discountTotal).toFixed(2),
    discountTotal.toFixed(2),
  ];
}