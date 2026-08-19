import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Armchair,
  Check,
  ArrowUp,
  ArrowDown,
  Info,
  DollarSign,
} from "lucide-react";
import {
  type PublicSeatEntry,
  CLICKABLE_SEAT_TYPES,
  NON_SEAT_TYPES_PUB,
  getCellIconPub,
} from "./constants";

export function PublicLayoutSeatPicker({
  seats,
  layout: _layout,
  floors,
  qty,
  selected,
  onToggle,
  pricePerPerson,
  numberingType,
}: {
  seats: PublicSeatEntry[];
  totalSeats: number;
  layout: string;
  floors: number;
  qty: number;
  selected: string[];
  onToggle: (n: string) => void;
  accentColor?: string;
  pricePerPerson?: number;
  numberingType?: string;
}) {
  const isBrazilian = numberingType?.includes("brazilian_standard") ?? false;
  const isMultiFloor = floors > 1;
  const [activeFloor, setActiveFloor] = useState<number>(isMultiFloor ? 2 : 1);

  const clickableSeats = useMemo(
    () => seats.filter((s) => CLICKABLE_SEAT_TYPES.includes(s.type)),
    [seats],
  );
  const occupiedCount = clickableSeats.filter((s) => s.status !== "available").length;
  const availableCount = clickableSeats.length - occupiedCount;
  const occupancyPct =
    clickableSeats.length > 0 ? Math.round((occupiedCount / clickableSeats.length) * 100) : 0;

  const floorCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let f = 1; f <= floors; f++) {
      counts[f] = seats.filter(
        (s) => s.floor === f && CLICKABLE_SEAT_TYPES.includes(s.type) && s.status === "available",
      ).length;
    }
    return counts;
  }, [seats, floors]);

  const activeSeats = useMemo(
    () =>
      [...seats.filter((s) => s.floor === activeFloor)].sort((a, b) =>
        a.row !== b.row ? a.row - b.row : a.col - b.col,
      ),
    [seats, activeFloor],
  );

  const maxRow = Math.max(...activeSeats.map((s) => s.row), 0);
  const maxCol = Math.max(...activeSeats.map((s) => s.col), 4);
  const aisleAfterCol = Math.ceil(maxCol / 2);

  const selectedSeatObjects = useMemo(
    () => seats.filter((s) => selected.includes(s.number)),
    [seats, selected],
  );

  function SeatCell({ seat }: { seat: PublicSeatEntry }) {
    const isNonSeat = NON_SEAT_TYPES_PUB.includes(seat.type);
    const isOccupied = !isNonSeat && seat.status !== "available";
    const isSelected = selected.includes(seat.number);
    const canSelect = !isNonSeat && !isOccupied && (isSelected || selected.length < qty);
    const isClickable = CLICKABLE_SEAT_TYPES.includes(seat.type) && !isOccupied;
    const isVip = seat.type === "vip";

    if (isNonSeat) {
      let nonSeatCls =
        "w-11 h-11 rounded-xl border-2 flex flex-col items-center justify-center text-xs font-medium select-none ";
      if (seat.type === "wc") nonSeatCls += "border-cyan-200 bg-cyan-50 text-cyan-600";
      else if (seat.type === "stairs") nonSeatCls += "border-purple-200 bg-purple-50 text-purple-600";
      else nonSeatCls += "border-gray-200 bg-gray-100 text-gray-400";
      return (
        <div className={nonSeatCls} title={seat.type}>
          <span className="text-sm">{getCellIconPub(seat.type, seat.number)}</span>
        </div>
      );
    }

    let btnCls =
      "w-11 h-11 rounded-xl border-2 flex flex-col items-center justify-center transition-all duration-200 select-none ";
    if (isSelected) {
      btnCls +=
        "bg-gradient-to-br from-green-400 to-green-600 text-white border-green-700 shadow-lg scale-105 ring-2 ring-green-300 ring-offset-1 cursor-pointer";
    } else if (isOccupied) {
      btnCls +=
        "bg-gradient-to-br from-red-300 to-red-400 text-white border-red-500 cursor-not-allowed opacity-75";
    } else if (canSelect) {
      if (isVip) {
        btnCls +=
          "bg-gradient-to-br from-yellow-300 to-yellow-400 text-yellow-900 border-yellow-500 hover:from-yellow-400 hover:to-yellow-500 hover:scale-105 hover:shadow-md cursor-pointer";
      } else {
        btnCls +=
          "bg-gradient-to-br from-blue-400 to-blue-500 text-white border-blue-600 hover:from-blue-500 hover:to-blue-600 hover:scale-105 hover:shadow-md cursor-pointer";
      }
    } else {
      btnCls +=
        "bg-gradient-to-br from-gray-200 to-gray-300 text-gray-500 border-gray-400 cursor-not-allowed opacity-60";
    }

    const seatPrice = pricePerPerson != null ? pricePerPerson * (isVip ? 1.1 : 1) : null;

    return (
      <div className="relative group">
        <button
          type="button"
          className={btnCls}
          onClick={() => isClickable && canSelect && onToggle(seat.number)}
          disabled={!isClickable || (!canSelect && !isSelected)}
          title={isOccupied ? `Assento ${seat.number} — Ocupado` : `Assento ${seat.number}`}
        >
          <Armchair className="w-4 h-4 mb-0.5 shrink-0" />
          <span className="text-[10px] font-bold leading-none">
            {isSelected ? "✓" : isOccupied ? "✗" : seat.number}
          </span>
          {!isOccupied && !isSelected && (
            <span className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/0 via-white/20 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          )}
        </button>

        {isVip && !isOccupied && (
          <span className="absolute -top-1.5 -right-1.5 z-10 bg-yellow-500 text-yellow-900 text-[9px] font-bold px-1 py-0.5 rounded-full shadow-sm border border-yellow-600 leading-none">
            VIP
          </span>
        )}

        {seatPrice != null && !isOccupied && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="bg-gray-900 text-white text-[10px] font-semibold px-2 py-1 rounded-lg shadow-xl whitespace-nowrap">
              {formatCurrency(seatPrice)}
              {isVip && <span className="ml-1 text-yellow-300">(+10%)</span>}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 -mt-px" />
          </div>
        )}
      </div>
    );
  }

  function FloorGrid({ floorNum }: { floorNum: number }) {
    const isUpper = floorNum === 2;
    const floorSeats = seats
      .filter((s) => s.floor === floorNum)
      .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));
    const fMaxRow = Math.max(...floorSeats.map((s) => s.row), 0);
    const fMaxCol = Math.max(...floorSeats.map((s) => s.col), 4);
    const fAisle = Math.ceil(fMaxCol / 2);

    return (
      <div className="space-y-3">
        <div
          className={`flex items-center justify-between p-4 rounded-2xl text-white shadow-sm ${isUpper ? "bg-gradient-to-r from-blue-600 to-blue-700" : "bg-gradient-to-r from-purple-600 to-purple-700"}`}
        >
          <div className="flex items-center gap-3">
            {isUpper ? <ArrowUp className="w-5 h-5" /> : <ArrowDown className="w-5 h-5" />}
            <div>
              <p className="font-bold text-sm">{isUpper ? "Piso Superior" : "Piso Inferior"}</p>
              <p className="text-xs text-white/80">{floorCounts[floorNum] ?? 0} assentos disponíveis</p>
            </div>
          </div>
          <span className="text-xs font-semibold bg-white/20 px-3 py-1 rounded-full border border-white/30">
            {floorSeats.filter((s) => CLICKABLE_SEAT_TYPES.includes(s.type)).length} lugares
          </span>
        </div>

        <div className="border-2 border-gray-200 rounded-2xl overflow-hidden shadow-inner">
          <div className="bg-gray-800 text-white text-xs font-bold py-2.5 text-center tracking-[0.15em]">
            {isUpper ? "🏢 PISO SUPERIOR — FRENTE" : "🚌 PISO INFERIOR — FRENTE"}
          </div>
          <div className="flex items-center justify-center gap-1 px-3 pt-2 pb-0.5">
            <div className="flex gap-1 text-[10px] text-gray-400 font-medium">
              {Array.from({ length: fAisle }, (_, i) => (
                <span key={i} className="w-11 text-center">{i === 0 ? "🪟" : "🚶"}</span>
              ))}
            </div>
            <div className="w-6" />
            <div className="flex gap-1 text-[10px] text-gray-400 font-medium">
              {Array.from({ length: fMaxCol - fAisle }, (_, i) => (
                <span key={i} className="w-11 text-center">{i === fMaxCol - fAisle - 1 ? "🪟" : "🚶"}</span>
              ))}
            </div>
          </div>
          <div className="bg-gradient-to-b from-gray-50 to-white p-3 space-y-1.5">
            {Array.from({ length: fMaxRow }, (_, rowIdx) => {
              const rowNum = rowIdx + 1;
              const rowSeats = floorSeats.filter((s) => s.row === rowNum);
              const leftSeats = rowSeats.filter((s) => s.col <= fAisle);
              const rightSeats = rowSeats.filter((s) => s.col > fAisle);
              return (
                <div key={rowNum} className="flex items-center justify-center gap-1">
                  <div className="flex gap-1">
                    {leftSeats.map((s) => <SeatCell key={s.number} seat={s} />)}
                  </div>
                  <div className="w-6 flex items-center justify-center text-gray-300 text-sm font-light select-none">|</div>
                  <div className="flex gap-1">
                    {rightSeats.map((s) => <SeatCell key={s.number} seat={s} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
          <p className="text-[11px] text-blue-100 mb-0.5">Total</p>
          <p className="text-2xl font-bold">{clickableSeats.length}</p>
        </div>
        <div className="rounded-xl p-3 bg-gradient-to-br from-green-500 to-green-600 text-white shadow-sm">
          <p className="text-[11px] text-green-100 mb-0.5">Disponíveis</p>
          <p className="text-2xl font-bold">{availableCount}</p>
        </div>
        <div className="rounded-xl p-3 bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-sm">
          <p className="text-[11px] text-orange-100 mb-0.5">Ocupação</p>
          <p className="text-2xl font-bold">{occupancyPct}%</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 inline-block shadow-sm" />
          Disponível
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-green-400 to-green-600 inline-block shadow-sm" />
          Selecionado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-red-300 to-red-400 inline-block shadow-sm" />
          Ocupado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-yellow-300 to-yellow-400 inline-block shadow-sm" />
          VIP (+10%)
        </span>
      </div>

      {isMultiFloor ? (
        <Tabs value={String(activeFloor)} onValueChange={(v) => setActiveFloor(Number(v))}>
          <TabsList className="grid w-full grid-cols-2 h-12 bg-gray-100 p-1 rounded-2xl shadow-sm">
            <TabsTrigger
              value="2"
              className="flex items-center gap-2 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-blue-600 rounded-xl transition-all"
            >
              <ArrowUp className="w-4 h-4" />
              Piso Superior
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                {floorCounts[2] ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="1"
              className="flex items-center gap-2 text-sm font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:text-purple-600 rounded-xl transition-all"
            >
              <ArrowDown className="w-4 h-4" />
              Piso Inferior
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold">
                {floorCounts[1] ?? 0}
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="2" className="mt-4">
            <FloorGrid floorNum={2} />
          </TabsContent>
          <TabsContent value="1" className="mt-4">
            <FloorGrid floorNum={1} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="border-2 border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-gray-800 text-white text-xs font-bold py-2.5 text-center tracking-[0.15em]">
            FRENTE DO ÔNIBUS
          </div>
          <div className="flex items-center justify-center gap-1 px-3 pt-2 pb-0.5">
            <div className="flex gap-1 text-[10px] text-gray-400 font-medium">
              {Array.from({ length: aisleAfterCol }, (_, i) => (
                <span key={i} className="w-11 text-center">{i === 0 ? "🪟" : "🚶"}</span>
              ))}
            </div>
            <div className="w-6" />
            <div className="flex gap-1 text-[10px] text-gray-400 font-medium">
              {Array.from({ length: maxCol - aisleAfterCol }, (_, i) => (
                <span key={i} className="w-11 text-center">{i === maxCol - aisleAfterCol - 1 ? "🪟" : "🚶"}</span>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 p-3 space-y-1.5">
            {Array.from({ length: maxRow }, (_, rowIdx) => {
              const rowNum = rowIdx + 1;
              const rowSeats = activeSeats.filter((s) => s.row === rowNum);
              const leftSeats = rowSeats.filter((s) => s.col <= aisleAfterCol);
              const rightSeats = rowSeats.filter((s) => s.col > aisleAfterCol);
              return (
                <div key={rowNum} className="flex items-center justify-center gap-1">
                  <div className="flex gap-1">
                    {leftSeats.map((s) => <SeatCell key={s.number} seat={s} />)}
                  </div>
                  <div className="w-6 flex items-center justify-center text-gray-300 text-sm font-light select-none">|</div>
                  <div className="flex gap-1">
                    {rightSeats.map((s) => <SeatCell key={s.number} seat={s} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="rounded-2xl border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50 p-4 shadow-sm"
          >
            <p className="font-bold text-green-800 flex items-center gap-2 mb-3 text-sm">
              <Check className="w-4 h-4 text-green-600" />
              Assentos Selecionados
            </p>
            <div className="space-y-2">
              {selectedSeatObjects.map((seat, idx) => {
                const isVip = seat.type === "vip";
                const price = pricePerPerson != null ? pricePerPerson * (isVip ? 1.1 : 1) : null;
                const seatNum = parseInt(seat.number, 10);
                const isWindowSeat = isBrazilian ? (seatNum % 2 !== 0) : null;
                const positionLabel = isWindowSeat === true ? "🪟 Janela" : isWindowSeat === false ? "🚶 Corredor" : null;
                return (
                  <motion.div
                    key={seat.number}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between p-3 bg-white rounded-xl border border-green-200 shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
                        {seat.number}
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-gray-900">Assento {seat.number}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
                          {floors > 1
                            ? seat.floor === 2
                              ? <><ArrowUp className="w-3 h-3" /> Piso Superior</>
                              : <><ArrowDown className="w-3 h-3" /> Piso Inferior</>
                            : null}
                          {positionLabel && (
                            <span className={`${floors > 1 ? "ml-1" : ""} font-medium ${isWindowSeat ? "text-sky-600" : "text-orange-500"}`}>{positionLabel}</span>
                          )}
                          {isVip && <span className="ml-1 text-yellow-600 font-semibold">• VIP</span>}
                        </p>
                      </div>
                    </div>
                    {price != null && (
                      <p className="font-bold text-green-600 text-sm">{formatCurrency(price)}</p>
                    )}
                  </motion.div>
                );
              })}
            </div>
            {pricePerPerson != null && selectedSeatObjects.length > 0 && (
              <div className="mt-3 pt-3 border-t-2 border-green-200 flex items-center justify-between">
                <span className="font-bold text-gray-900 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Total
                </span>
                <span className="text-xl font-bold text-green-600">
                  {formatCurrency(
                    selectedSeatObjects.reduce(
                      (sum, s) => sum + pricePerPerson * (s.type === "vip" ? 1.1 : 1),
                      0,
                    ),
                  )}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-900">
            <p className="font-bold mb-1.5">💡 Dicas para escolher seu assento:</p>
            <ul className="space-y-1 text-xs text-blue-800">
              <li>• Assentos VIP oferecem mais espaço e conforto (+10%)</li>
              <li>• Piso inferior geralmente tem menos movimento</li>
              <li>• Assentos próximos à entrada facilitam o embarque</li>
              <li>• Selecione exatamente {qty} assento{qty !== 1 ? "s" : ""} para continuar</li>
            </ul>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {selected.length}/{qty} assento{qty !== 1 ? "s" : ""} selecionado{qty !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

export function SeatGrid({
  totalCapacity,
  occupiedSeats,
  qty,
  selected,
  onToggle,
  accentColor,
}: {
  totalCapacity: number;
  occupiedSeats: number[];
  qty: number;
  selected: number[];
  onToggle: (n: number) => void;
  accentColor?: string;
}) {
  const accent = accentColor || "#f97316";
  const availableCount = totalCapacity - occupiedSeats.length;
  const rowCount = Math.ceil(totalCapacity / 4);

  function SeatBtn({ seatNum }: { seatNum: number }) {
    const isOccupied = occupiedSeats.includes(seatNum);
    const isSelected = selected.includes(seatNum);
    const canSelect = !isOccupied && (isSelected || selected.length < qty);
    let style: React.CSSProperties = {};
    let cls =
      "relative w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 flex items-center justify-center text-sm font-bold transition-all select-none ";
    if (isOccupied) {
      cls += "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed";
    } else if (isSelected) {
      cls += "border-transparent text-white cursor-pointer";
      style = { backgroundColor: accent, borderColor: accent };
    } else if (canSelect) {
      cls += "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 cursor-pointer";
    } else {
      cls += "border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed";
    }
    return (
      <button
        onClick={() => canSelect && onToggle(seatNum)}
        disabled={isOccupied}
        title={isOccupied ? `Assento ${seatNum} — Ocupado` : `Assento ${seatNum}`}
        className={cls}
        style={style}
      >
        {seatNum}
        {isSelected && (
          <span className="absolute top-0.5 right-0.5">
            <Check className="w-3 h-3 text-white" />
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">Layout: 2×2 Padrão</span>
        <span>
          <strong className="text-foreground">{availableCount}</strong> disponíveis &middot; {totalCapacity} total
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border-2 border-gray-300 bg-white inline-block" />
          Disponível
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border-2 border-gray-200 bg-gray-100 inline-block" />
          Ocupado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded inline-block" style={{ backgroundColor: accent }} />
          Selecionado
        </span>
      </div>

      <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gray-800 text-white text-xs font-bold py-2.5 text-center tracking-[0.15em]">
          FRENTE DO ÔNIBUS
        </div>
        <div className="flex items-center justify-center gap-1 px-3 pt-2 pb-0 text-[10px] text-gray-400 font-medium">
          <span className="w-12 sm:w-14 text-center">🪟</span>
          <span className="w-12 sm:w-14 text-center">🚶</span>
          <div className="w-6" />
          <span className="w-12 sm:w-14 text-center">🚶</span>
          <span className="w-12 sm:w-14 text-center">🪟</span>
        </div>
        <div className="bg-gray-50 p-3 space-y-2">
          {Array.from({ length: rowCount }, (_, rowIdx) => {
            const s1 = rowIdx * 4 + 1;
            const s2 = rowIdx * 4 + 2;
            const s3 = rowIdx * 4 + 3;
            const s4 = rowIdx * 4 + 4;
            return (
              <div key={rowIdx} className="flex items-center justify-center gap-1">
                <div className="flex gap-1.5">
                  {s1 <= totalCapacity && <SeatBtn seatNum={s1} />}
                  {s2 <= totalCapacity && <SeatBtn seatNum={s2} />}
                </div>
                <div className="w-6 flex items-center justify-center text-gray-300 text-sm font-light select-none">
                  |
                </div>
                <div className="flex gap-1.5">
                  {s4 <= totalCapacity && <SeatBtn seatNum={s4} />}
                  {s3 <= totalCapacity && <SeatBtn seatNum={s3} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-3">
        Selecione exatamente {qty} assento{qty !== 1 ? "s" : ""} para continuar{" "}
        ({selected.length}/{qty} selecionado{qty !== 1 ? "s" : ""})
      </p>
    </div>
  );
}
