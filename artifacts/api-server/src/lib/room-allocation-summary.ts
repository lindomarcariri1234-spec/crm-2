export type RoomAllocationRoom = {
  id: string;
  category: string;
  capacity: number;
  pricePerNight: string | number | null;
};

export type RoomAllocationSummary = {
  nights: number;
  rows: Array<{
    category: string;
    roomCount: number;
    guestsPerRoom: number;
    totalGuests: number;
    pricePerNight: number | null;
    packageValue: number | null;
    subtotal: number | null;
  }>;
  totalRooms: number;
  totalGuests: number;
  totalValue: number | null;
};

export function buildRoomAllocationSummary(
  rooms: RoomAllocationRoom[],
  assignedRoomIds: string[],
  nights: number,
): RoomAllocationSummary {
  const assignedByRoom = new Map<string, number>();
  for (const roomId of assignedRoomIds) {
    assignedByRoom.set(roomId, (assignedByRoom.get(roomId) ?? 0) + 1);
  }

  const groups = new Map<string, {
    category: string;
    roomCount: number;
    guestsPerRoom: number;
    totalGuests: number;
    pricePerNight: number | null;
  }>();

  for (const room of rooms) {
    const guestCount = assignedByRoom.get(room.id) ?? 0;
    if (guestCount === 0) continue;
    const pricePerNight = room.pricePerNight == null ? null : Number(room.pricePerNight);
    const key = `${room.category}\u0000${room.capacity}\u0000${pricePerNight ?? "missing"}`;
    const current = groups.get(key) ?? {
      category: room.category,
      roomCount: 0,
      guestsPerRoom: room.capacity,
      totalGuests: 0,
      pricePerNight,
    };
    current.roomCount += 1;
    current.totalGuests += guestCount;
    groups.set(key, current);
  }

  const rows = [...groups.values()].map(group => {
    const packageValue = group.pricePerNight == null
      ? null
      : roundCurrency(group.pricePerNight * nights);
    return {
      ...group,
      packageValue,
      subtotal: packageValue == null ? null : roundCurrency(packageValue * group.roomCount),
    };
  });
  const hasMissingRate = rows.some(row => row.subtotal == null);

  return {
    nights,
    rows,
    totalRooms: rows.reduce((sum, row) => sum + row.roomCount, 0),
    totalGuests: rows.reduce((sum, row) => sum + row.totalGuests, 0),
    totalValue: hasMissingRate
      ? null
      : roundCurrency(rows.reduce((sum, row) => sum + (row.subtotal ?? 0), 0)),
  };
}

export function getTripNights(departureDate: Date, returnDate: Date | null): number {
  if (!returnDate) return 1;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((returnDate.getTime() - departureDate.getTime()) / millisecondsPerDay));
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
