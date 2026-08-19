export interface TripDuration {
  totalMinutes: number;
  days: number;
  hours: number;
  formatted: string;
  formattedShort: string;
}

export function calculateTripDuration(
  departureDate?: string | null,
  returnDate?: string | null,
  departureTime?: string | null,
  returnTime?: string | null,
): TripDuration | null {
  if (!departureDate || !returnDate) return null;

  const depDateStr = departureDate.length <= 10 ? departureDate : departureDate.slice(0, 10);
  const retDateStr = returnDate.length <= 10 ? returnDate : returnDate.slice(0, 10);

  const [depH = 0, depM = 0] = departureTime
    ? departureTime.split(":").map(Number)
    : [0, 0];
  const [retH = 0, retM = 0] = returnTime
    ? returnTime.split(":").map(Number)
    : [0, 0];

  const departure = new Date(
    `${depDateStr}T${String(depH).padStart(2, "0")}:${String(depM).padStart(2, "0")}:00`,
  );
  const returnDt = new Date(
    `${retDateStr}T${String(retH).padStart(2, "0")}:${String(retM).padStart(2, "0")}:00`,
  );

  const totalMinutes = Math.max(
    0,
    Math.round((returnDt.getTime() - departure.getTime()) / 60000),
  );
  if (totalMinutes === 0) return null;

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  let formatted: string;
  if (days === 0) {
    formatted = `${hours} hora${hours !== 1 ? "s" : ""}`;
  } else if (hours === 0) {
    formatted = `${days} dia${days !== 1 ? "s" : ""}`;
  } else {
    formatted = `${days} dia${days !== 1 ? "s" : ""} e ${hours} hora${hours !== 1 ? "s" : ""}`;
  }

  let formattedShort: string;
  if (days === 0) {
    formattedShort = `${hours}h`;
  } else if (hours === 0) {
    formattedShort = `${days}d`;
  } else {
    formattedShort = `${days}d ${hours}h`;
  }

  return { totalMinutes, days, hours, formatted, formattedShort };
}
