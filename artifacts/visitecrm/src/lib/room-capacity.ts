export type RoomCapacityError = {
  roomId: string;
  capacity: number;
  occupied: number;
  currentOccupied: number;
  requestedCount?: number;
};

export type RoomCapacityFeedback = {
  title: string;
  description: string;
};

export function getRoomCapacityError(error: unknown): RoomCapacityError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    data?: unknown;
    response?: { data?: unknown };
  };
  const data = candidate.data ?? candidate.response?.data;
  if (!data || typeof data !== "object") return null;
  const details = data as Record<string, unknown>;
  if (
    details.code !== "ROOM_CAPACITY_EXCEEDED" ||
    typeof details.roomId !== "string" ||
    typeof details.capacity !== "number" ||
    typeof details.occupied !== "number"
  ) {
    return null;
  }
  return {
    roomId: details.roomId,
    capacity: details.capacity,
    occupied: details.occupied,
    currentOccupied: typeof details.currentOccupied === "number" ? details.currentOccupied : details.occupied,
    requestedCount: typeof details.requestedCount === "number" ? details.requestedCount : undefined,
  };
}

export function formatRoomCapacityError(
  error: RoomCapacityError,
  roomName = "quarto selecionado",
): RoomCapacityFeedback {
  return {
    title: `${roomName} sem vagas`,
    description: `Capacidade: ${error.capacity} pessoa(s). Ocupação atual: ${error.currentOccupied}. Vagas disponíveis antes desta tentativa: ${Math.max(0, error.capacity - error.currentOccupied)}.`,
  };
}