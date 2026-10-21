export interface StorefrontCoPassenger {
  name: string;
  cpf?: string;
  phone?: string;
  isChildUnder7?: boolean;
  occupiesSeat?: boolean;
}

export type StorefrontPassengerPolicyError = {
  code: "CHILD_SEAT_SELECTION_REQUIRED" | "CHILD_OVER_7_REQUIRES_SEAT";
  message: string;
};

/**
 * Older pending orders have no seat flag, so their companions remain
 * seat-bearing passengers. New lap children explicitly send occupiesSeat=false.
 */
export function countSeatBearingCoPassengers(
  passengers: readonly StorefrontCoPassenger[],
): number {
  return passengers.filter((passenger) => passenger.occupiesSeat !== false).length;
}

export function getStorefrontPassengerPolicyError(
  passengers: readonly StorefrontCoPassenger[],
): StorefrontPassengerPolicyError | null {
  for (const passenger of passengers) {
    const hasAgeFlag = passenger.isChildUnder7 !== undefined;
    const hasSeatFlag = passenger.occupiesSeat !== undefined;

    if (hasAgeFlag !== hasSeatFlag) {
      return {
        code: "CHILD_SEAT_SELECTION_REQUIRED",
        message: "Selecione a idade e a forma de viagem de cada criança.",
      };
    }

    if (passenger.occupiesSeat === false && passenger.isChildUnder7 !== true) {
      return {
        code: "CHILD_OVER_7_REQUIRES_SEAT",
        message: "Crianças a partir de 7 anos precisam ocupar uma poltrona.",
      };
    }
  }

  return null;
}
