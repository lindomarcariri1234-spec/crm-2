import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { getCountdownLabel, parseTripDateTime } from "./utils";

export function TripCountdown({ date, time }: { date: string; time?: string | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, []);
  void tick;
  const label = getCountdownLabel(date, time);
  const urgent = (() => {
    try {
      const diff = parseTripDateTime(date, time).getTime() - Date.now();
      return diff >= 0 && diff < 1000 * 60 * 60 * 24;
    } catch {
      return false;
    }
  })();
  return (
    <Badge variant={label === "Encerrado" || urgent ? "destructive" : "secondary"} className="text-xs">
      {label || "Em breve"}
    </Badge>
  );
}

export function OccupancyBar({ reserved, confirmed, free = 0, total }: { reserved: number; confirmed: number; free?: number; total: number }) {
  const occupied = reserved + confirmed + free;
  const pct = total > 0 ? Math.round(occupied / total * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{occupied}/{total} assentos</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
