import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO, isSameDay, isToday, startOfMonth, endOfMonth, eachDayOfInterval, getDay, startOfWeek, addDays, addMonths, addWeeks, subMonths, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useListTrips } from "@workspace/api-client-react";
import type { Trip } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, Edit, Eye } from "lucide-react";
import { STATUS_MAP } from "./constants";
import { formatCurrency, formatDate } from "./utils";
import { TRIP_STATUS } from "@workspace/permissions";

const STATUS_COLORS: Record<string, string> = {
  [TRIP_STATUS.DRAFT]: "bg-gray-200 text-gray-700",
  [TRIP_STATUS.ACTIVE]: "bg-green-100 text-green-700",
  [TRIP_STATUS.CONFIRMED]: "bg-blue-100 text-blue-700",
  [TRIP_STATUS.COMPLETED]: "bg-purple-100 text-purple-700",
  [TRIP_STATUS.CANCELLED]: "bg-red-100 text-red-700",
};

export function TripCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);

  const { data: tripsData } = useListTrips({ limit: 200 });
  const trips = tripsData?.data ?? [];

  const tripsOnDay = (day: Date) => trips.filter(t => { try { return isSameDay(parseISO(t.departureDate), day); } catch { return false; } });

  const MonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startDow = getDay(monthStart);
    return (
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => (
            <div key={d} className="p-3 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startDow }).map((_, i) => <div key={`e-${i}`} className="min-h-[100px] border-b border-r bg-muted/20" />)}
          {calendarDays.map(day => {
            const dayTrips = tripsOnDay(day);
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className={`min-h-[100px] border-b border-r p-1.5 ${today ? "bg-primary/5" : ""}`}>
                <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${today ? "bg-primary text-white" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayTrips.map(trip => (
                    <button key={trip.id} className={`w-full text-left px-1.5 py-0.5 rounded text-xs truncate ${STATUS_COLORS[trip.status] ?? "bg-gray-100"}`} onClick={() => setSelectedTrip(trip)}>
                      {trip.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const WeekView = () => {
    const weekStart = startOfWeek(currentDate, { locale: ptBR });
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return (
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {weekDays.map(day => (
            <div key={day.toISOString()} className={`p-3 text-center border-r last:border-r-0 ${isToday(day) ? "bg-primary/5" : ""}`}>
              <p className="text-xs text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</p>
              <p className={`text-sm font-medium mt-0.5 ${isToday(day) ? "text-primary font-bold" : ""}`}>{format(day, "d")}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 min-h-[300px]">
          {weekDays.map(day => {
            const dayTrips = tripsOnDay(day);
            return (
              <div key={day.toISOString()} className={`p-2 border-r last:border-r-0 space-y-1 ${isToday(day) ? "bg-primary/5" : ""}`}>
                {dayTrips.map(trip => (
                  <button key={trip.id} className={`w-full text-left px-2 py-1.5 rounded text-xs ${STATUS_COLORS[trip.status] ?? "bg-gray-100"}`} onClick={() => setSelectedTrip(trip)}>
                    <p className="font-medium truncate">{trip.name}</p>
                    <p className="text-xs opacity-70">{trip.destinationCity}</p>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const DayView = () => {
    const dayTrips = tripsOnDay(currentDate);
    return (
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold">{format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}</h3>
        {dayTrips.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">Nenhuma viagem neste dia</p>
        ) : (
          <div className="space-y-3">
            {dayTrips.map(trip => (
              <div key={trip.id} className={`p-4 rounded-lg cursor-pointer ${STATUS_COLORS[trip.status] ?? "bg-gray-100"}`} onClick={() => setSelectedTrip(trip)}>
                <p className="font-semibold">{trip.name}</p>
                <p className="text-sm mt-1">{trip.destinationCity}, {trip.destinationState}</p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span>{trip.totalCapacity} assentos</span>
                  <span>{formatCurrency(trip.priceAdult)}/pessoa</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const goBack = () => {
    if (view === "month") setCurrentDate(d => subMonths(d, 1));
    else if (view === "week") setCurrentDate(d => subWeeks(d, 1));
    else setCurrentDate(d => addDays(d, -1));
  };
  const goForward = () => {
    if (view === "month") setCurrentDate(d => addMonths(d, 1));
    else if (view === "week") setCurrentDate(d => addWeeks(d, 1));
    else setCurrentDate(d => addDays(d, 1));
  };

  const title = view === "month"
    ? format(currentDate, "MMMM yyyy", { locale: ptBR })
    : view === "week"
    ? `Semana de ${format(startOfWeek(currentDate, { locale: ptBR }), "d MMM", { locale: ptBR })}`
    : format(currentDate, "d 'de' MMMM yyyy", { locale: ptBR });


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => history.back()}><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-2xl font-bold tracking-tight">Calendário de Viagens</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden">
            {(["month", "week", "day"] as const).map(v => (
              <Button key={v} variant={view === v ? "default" : "ghost"} size="sm" className="rounded-none text-xs" onClick={() => setView(v)}>
                {v === "month" ? "Mês" : v === "week" ? "Semana" : "Dia"}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={goBack}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium min-w-[160px] text-center capitalize">{title}</span>
          <Button variant="outline" size="icon" onClick={goForward}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Hoje</Button>
        </div>
      </div>

      {view === "month" ? <MonthView /> : view === "week" ? <WeekView /> : <DayView />}

      <Dialog open={!!selectedTrip} onOpenChange={() => setSelectedTrip(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selectedTrip?.name}</DialogTitle></DialogHeader>
          {selectedTrip && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-muted-foreground">Destino</p><p className="font-medium">{selectedTrip.destinationCity}, {selectedTrip.destinationState}</p></div>
                <div><p className="text-muted-foreground">Data de Saída</p><p className="font-medium">{formatDate(selectedTrip.departureDate)}</p></div>
                <div><p className="text-muted-foreground">Capacidade</p><p className="font-medium">{selectedTrip.totalCapacity} assentos</p></div>
                <div><p className="text-muted-foreground">Preço Adulto</p><p className="font-medium">{formatCurrency(selectedTrip.priceAdult)}</p></div>
                <div><p className="text-muted-foreground">Ocupação</p><p className="font-medium">{selectedTrip.reservedSeats + selectedTrip.confirmedSeats} reservado(s)</p></div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedTrip.status] ?? "bg-gray-100"}`}>
                    {STATUS_MAP[selectedTrip.status]?.label ?? selectedTrip.status}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/trips/${selectedTrip.id}/passengers-overview`} className="flex-1">
                  <Button variant="outline" className="w-full" onClick={() => setSelectedTrip(null)}><Eye className="w-4 h-4 mr-2" />Visão Geral</Button>
                </Link>
                <Link href={`/trips/${selectedTrip.id}/edit`} className="flex-1">
                  <Button className="w-full" onClick={() => setSelectedTrip(null)}><Edit className="w-4 h-4 mr-2" />Editar</Button>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
