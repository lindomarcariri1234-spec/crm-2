import { useMemo, useEffect, useState } from "react";
import { useGetTripSeatMap } from "@workspace/api-client-react";
import type { Seat } from "@workspace/api-client-react";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { Skeleton } from "@/components/ui/skeleton";

const CLICKABLE_TYPES = ["seat", "vip", "accessible"];

interface SeatMapPickerProps {
  tripId: string;
  selectedSeats: string[];
  onSeatsChange: (seats: string[]) => void;
  maxSeats?: number;
  onHasMap?: (hasMap: boolean) => void;
}

type SeatWithType = Seat & { type?: string; floor?: number };

export function getSeatColor(status: string, selected: boolean, type?: string) {
  if (selected) return "bg-primary border-2 border-primary text-primary-foreground cursor-pointer";

  if (type === "wc") return "bg-cyan-100 border-2 border-cyan-300 text-cyan-700 cursor-not-allowed";
  if (type === "stairs") return "bg-purple-100 border-2 border-purple-300 text-purple-700 cursor-not-allowed";
  if (type === "fridge") return "bg-sky-100 border-2 border-sky-300 text-sky-700 cursor-not-allowed";
  if (type === "blocked") return "bg-gray-100 border-2 border-gray-300 text-gray-400 cursor-not-allowed";

  switch (status) {
    case "available":
      if (type === "vip") return "bg-yellow-50 border-2 border-yellow-500 hover:border-yellow-600 hover:bg-yellow-100 text-yellow-800 cursor-pointer shadow-[0_0_0_1px_theme(colors.yellow.400)]";
      if (type === "accessible") return "bg-blue-50 border-2 border-blue-400 hover:border-blue-600 hover:bg-blue-100 text-blue-800 cursor-pointer";
      return "bg-white border-2 border-gray-200 hover:border-primary hover:bg-primary/10 cursor-pointer";
    case "reserved":
    case "occupied":
      return "bg-orange-400 border-2 border-orange-500 text-white cursor-not-allowed";
    case RESERVATION_STATUS.CONFIRMED:
      return "bg-green-500 border-2 border-green-600 text-white cursor-not-allowed";
    case "free":
      return "bg-violet-500 border-2 border-violet-600 text-white cursor-not-allowed";
    case "blocked":
    case "wc":
    case "stairs":
    case "fridge":
      return "bg-gray-100 border-2 border-gray-200 text-gray-400 cursor-not-allowed";
    default:
      return "bg-gray-100 border-2 border-gray-200 cursor-not-allowed";
  }
}

export function getCellIcon(type?: string, seatNumber?: string): string {
  switch (type) {
    case "wc": return "🚽";
    case "stairs": return "🪜";
    case "fridge": return "🧊";
    case "blocked": return "✕";
    case "vip": return "★";
    case "accessible": return "♿";
    default: return seatNumber ?? "";
  }
}

const NON_SEAT_TYPES = ["wc", "stairs", "fridge", "blocked", "empty"];

function getCellTitle(seat: SeatWithType, selected: boolean): string {
  const typeLabel: Record<string, string> = {
    wc: "Banheiro",
    stairs: "Escada",
    fridge: "Frigobar",
    blocked: "Bloqueado",
    vip: `Assento VIP ${seat.number}`,
    accessible: `Assento Acessível ${seat.number}`,
  };
  if (seat.type && typeLabel[seat.type]) return typeLabel[seat.type];
  if (selected) return `Assento ${seat.number} — Selecionado`;
  if (seat.status === "free") {
    const name = (seat as SeatWithType & { occupantName?: string | null }).occupantName;
    return `Assento ${seat.number} — Gratuidade${name ? `: ${name}` : ""}`;
  }
  return `Assento ${seat.number} — ${seat.status}`;
}

function SeatGrid({
  seats,
  selectedSeats,
  onSeatClick,
}: {
  seats: SeatWithType[];
  selectedSeats: string[];
  onSeatClick: (seat: SeatWithType) => void;
}) {
  const maxRow = Math.max(...seats.map(s => s.row), 0);
  const maxCol = Math.max(...seats.map(s => s.col), 4);
  const aisleAfterCol = Math.ceil(maxCol / 2);

  return (
    <div className="space-y-1.5 max-w-xs mx-auto">
      <div className="flex items-center justify-center gap-2">
        <div className="flex gap-1">
          {Array.from({ length: aisleAfterCol }, (_, i) => (
            <span key={i} className="w-9 text-center text-[10px] text-muted-foreground">{i === 0 ? "🪟" : "🚶"}</span>
          ))}
        </div>
        <div className="w-4" />
        <div className="flex gap-1">
          {Array.from({ length: maxCol - aisleAfterCol }, (_, i) => (
            <span key={i} className="w-9 text-center text-[10px] text-muted-foreground">{i === maxCol - aisleAfterCol - 1 ? "🪟" : "🚶"}</span>
          ))}
        </div>
      </div>
      {Array.from({ length: maxRow }).map((_, rowIdx) => {
        const rowNum = rowIdx + 1;
        const rowSeats = seats.filter(s => s.row === rowNum);
        const leftSeats = rowSeats.filter(s => s.col <= aisleAfterCol);
        const rightSeats = rowSeats.filter(s => s.col > aisleAfterCol);

        return (
          <div key={rowNum} className="flex items-center gap-2 justify-center">
            <div className="flex gap-1">
              {leftSeats.map(s => {
                const isNonSeat = NON_SEAT_TYPES.includes(s.type ?? "");
                const isClickable = CLICKABLE_TYPES.includes(s.type ?? "seat");
                const isSelected = selectedSeats.includes(s.number);
                const cellClass = `w-9 h-9 rounded-md text-xs font-bold flex items-center justify-center transition-all ${getSeatColor(s.status, isSelected, s.type)}`;
                if (isNonSeat) {
                  return (
                    <div key={s.number} className={cellClass} title={getCellTitle(s, false)}>
                      {getCellIcon(s.type)}
                    </div>
                  );
                }
                return (
                  <button
                    key={s.number}
                    type="button"
                    className={cellClass}
                    onClick={() => onSeatClick(s)}
                    title={getCellTitle(s, isSelected)}
                    disabled={!isClickable || (s.status !== "available" && !isSelected)}
                  >
                    {getCellIcon(s.type, isSelected ? "✓" : s.number)}
                  </button>
                );
              })}
            </div>
            <div className="w-4 text-center text-xs text-muted-foreground shrink-0">|</div>
            <div className="flex gap-1">
              {rightSeats.map(s => {
                const isNonSeat = NON_SEAT_TYPES.includes(s.type ?? "");
                const isClickable = CLICKABLE_TYPES.includes(s.type ?? "seat");
                const isSelected = selectedSeats.includes(s.number);
                const cellClass = `w-9 h-9 rounded-md text-xs font-bold flex items-center justify-center transition-all ${getSeatColor(s.status, isSelected, s.type)}`;
                if (isNonSeat) {
                  return (
                    <div key={s.number} className={cellClass} title={getCellTitle(s, false)}>
                      {getCellIcon(s.type)}
                    </div>
                  );
                }
                return (
                  <button
                    key={s.number}
                    type="button"
                    className={cellClass}
                    onClick={() => onSeatClick(s)}
                    title={getCellTitle(s, isSelected)}
                    disabled={!isClickable || (s.status !== "available" && !isSelected)}
                  >
                    {getCellIcon(s.type, isSelected ? "✓" : s.number)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SeatMapPicker({ tripId, selectedSeats, onSeatsChange, maxSeats, onHasMap }: SeatMapPickerProps) {
  const { data: seatMap, isLoading } = useGetTripSeatMap(tripId, {
    query: { queryKey: ["seat-map-picker", tripId], refetchInterval: 8000 },
  });

  const seats = useMemo<SeatWithType[]>(() => {
    if (!seatMap?.seats) return [];
    return [...(seatMap.seats as SeatWithType[])].sort((a, b) => {
      const fa = a.floor ?? 1, fb = b.floor ?? 1;
      if (fa !== fb) return fa - fb;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  }, [seatMap]);

  const maxFloor = useMemo(() => Math.max(...seats.map(s => s.floor ?? 1), 1), [seats]);
  const isMultiFloor = maxFloor > 1;

  const [activeFloor, setActiveFloor] = useState<number>(isMultiFloor ? 2 : 1);

  useEffect(() => {
    setActiveFloor(isMultiFloor ? 2 : 1);
  }, [isMultiFloor]);

  useEffect(() => {
    if (!isLoading) {
      onHasMap?.(seats.length > 0);
    }
  }, [isLoading, seats.length]);

  const activeSeats = useMemo(
    () => seats.filter(s => (s.floor ?? 1) === activeFloor),
    [seats, activeFloor]
  );

  const clickableSeats = useMemo(() =>
    seats.filter(s => CLICKABLE_TYPES.includes(s.type ?? "seat")),
    [seats]
  );

  const seatCounts = useMemo(() => ({
    available: clickableSeats.filter(s => s.status === "available").length,
    reserved: clickableSeats.filter(s => s.status === "reserved" || s.status === "occupied").length,
    confirmed: clickableSeats.filter(s => s.status === RESERVATION_STATUS.CONFIRMED).length,
  }), [clickableSeats]);

  const floorCounts = useMemo(() => {
    const counts: Record<number, { available: number; total: number }> = {};
    for (let f = 1; f <= maxFloor; f++) {
      const floorSeats = seats.filter(s => (s.floor ?? 1) === f && CLICKABLE_TYPES.includes(s.type ?? "seat"));
      counts[f] = {
        available: floorSeats.filter(s => s.status === "available").length,
        total: floorSeats.length,
      };
    }
    return counts;
  }, [seats, maxFloor]);

  const handleSeatClick = (seat: SeatWithType) => {
    if (!CLICKABLE_TYPES.includes(seat.type ?? "seat")) return;
    if (seat.status !== "available") return;
    const isSelected = selectedSeats.includes(seat.number);
    if (isSelected) {
      onSeatsChange(selectedSeats.filter(s => s !== seat.number));
    } else {
      if (maxSeats && selectedSeats.length >= maxSeats) return;
      onSeatsChange([...selectedSeats, seat.number]);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!seatMap || seats.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-6 border rounded-lg bg-muted/20">
        Mapa de assentos não disponível para esta viagem.<br />
        Informe os assentos manualmente no passo seguinte.
      </div>
    );
  }

  const hasCustomTypes = seats.some(s => s.type && s.type !== "seat");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {isMultiFloor
            ? <strong>Double Decker — {maxFloor} andares</strong>
            : <strong>{seatMap.layout === "2x1" ? "2x1 Premium" : "2x2 Padrão"}</strong>
          }
        </span>
        <span>{seatCounts.available} disponíveis · {seatMap.totalSeats} total</span>
      </div>

      {isMultiFloor && (
        <div className="flex gap-2">
          {[2, 1].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFloor(f)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                activeFloor === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/50 text-muted-foreground border-gray-200 hover:border-gray-400 hover:bg-muted"
              }`}
            >
              {f === 2 ? "🏢 Piso Superior" : "🚌 Piso Inferior"}
              <span className={`ml-1.5 text-xs ${activeFloor === f ? "opacity-80" : "opacity-60"}`}>
                ({floorCounts[f]?.available ?? 0} disp.)
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-gray-800 text-white text-center py-2 rounded-lg text-xs font-medium">
        {isMultiFloor
          ? activeFloor === 2 ? "🏢 PISO SUPERIOR — FRENTE" : "🚌 PISO INFERIOR — FRENTE"
          : "FRENTE DO ÔNIBUS"
        }
      </div>

      <SeatGrid
        seats={activeSeats}
        selectedSeats={selectedSeats}
        onSeatClick={handleSeatClick}
      />

      <div className="flex items-center gap-3 justify-center text-xs flex-wrap pt-1">
        {[
          { color: "bg-primary", label: "Selecionado" },
          { color: "bg-white border-2 border-gray-200", label: "Disponível" },
          { color: "bg-yellow-50 border-2 border-yellow-500", label: "VIP ★" },
          { color: "bg-blue-50 border-2 border-blue-400", label: "Acessível ♿" },
          { color: "bg-orange-400", label: "Reservado" },
          { color: "bg-green-500", label: "Confirmado" },
          { color: "bg-gray-300", label: "Bloqueado" },
          ...(hasCustomTypes ? [
            { color: "bg-cyan-100 border-2 border-cyan-300", label: "Banheiro 🚽" },
            { color: "bg-purple-100 border-2 border-purple-300", label: "Escada 🪜" },
          ] : []),
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3.5 h-3.5 rounded ${l.color}`} />
            <span className="text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>

      {selectedSeats.length > 0 && (() => {
        const isBrazilian = (seatMap as { numberingType?: string } | undefined)?.numberingType?.includes("brazilian_standard") ?? false;
        return (
          <div className="space-y-1">
            <p className="text-center text-xs text-muted-foreground font-medium">
              {selectedSeats.length} assento{selectedSeats.length !== 1 ? "s" : ""} selecionado{selectedSeats.length !== 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {selectedSeats.map((num) => {
                const seatNum = parseInt(num, 10);
                const isWindow = isBrazilian ? seatNum % 2 !== 0 : null;
                const posText = isWindow === true ? "🪟 Janela" : isWindow === false ? "🚶 Corredor" : null;
                return (
                  <span key={num} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {num}{posText && <span className={`text-[10px] font-medium ${isWindow ? "text-sky-600" : "text-orange-500"}`}>{posText}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
