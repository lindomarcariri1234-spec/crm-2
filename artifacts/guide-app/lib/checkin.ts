export type PassengerCheckinStatus = "checado" | "ausente" | "pendente";
export type ServerCheckinStatus = "present" | "absent";

export interface PendingCheckin {
  operation: "upsert" | "delete";
  passengerId: string;
  reservationId: string;
  status: ServerCheckinStatus;
  queuedAt: string;
}

export interface CheckinMutation {
  tripId: string;
  token: string;
  passengerId: string;
  reservationId: string;
  currentStatus: PassengerCheckinStatus;
  newStatus: ServerCheckinStatus;
}

type CheckinRequest = (
  path: string,
  token: string,
  options: RequestInit,
) => Promise<unknown>;

export async function submitCheckinStatus(
  mutation: CheckinMutation,
  request: CheckinRequest,
): Promise<void> {
  if (mutation.currentStatus !== "pendente") {
    await request(
      `/api/guide/trip/${mutation.tripId}/checkins/${mutation.passengerId}`,
      mutation.token,
      { method: "DELETE" },
    );
  }

  await request(
    `/api/guide/trip/${mutation.tripId}/checkins`,
    mutation.token,
    {
      method: "POST",
      body: JSON.stringify({
        passengerId: mutation.passengerId,
        reservationId: mutation.reservationId,
        status: mutation.newStatus,
      }),
    },
  );
}

export function coalescePendingCheckin(
  pending: PendingCheckin[],
  mutation: Omit<PendingCheckin, "queuedAt">,
  queuedAt: string,
): PendingCheckin[] {
  return [
    ...pending.filter((item) => item.passengerId !== mutation.passengerId),
    { ...mutation, queuedAt },
  ];
}