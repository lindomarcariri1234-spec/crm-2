import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetTripBoardingPanel } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Clock, Search, ArrowLeft, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface CheckinRecord {
  passengerId: string;
  status: string;
  checkedInAt: string;
}

export function TabletCheckin({ tripId }: { tripId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "present" | "absent">("all");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data: panel, isLoading, refetch: refetchPanel } = useGetTripBoardingPanel(tripId, {
    query: { queryKey: ["boarding-panel-tablet", tripId], refetchInterval: 20000 },
  });

  const { data: checkinsData, refetch: refetchCheckins } = useQuery<{ data: CheckinRecord[] }>({
    queryKey: ["trip-checkins-tablet", tripId],
    queryFn: async () => {
      const r = await fetch(`/api/trips/${tripId}/checkins`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 20000,
  });

  const checkinMap = useMemo(() =>
    new Map((checkinsData?.data ?? []).map(c => [c.passengerId, c])),
    [checkinsData?.data]
  );

  const passengers = panel?.passengers ?? [];
  const totalPassengers = panel?.totalPassengers ?? 0;
  const checkedInCount = passengers.filter(p => checkinMap.get(p.id)?.status === "present").length;
  const progressPct = totalPassengers > 0 ? Math.round((checkedInCount / totalPassengers) * 100) : 0;

  const boardingPoints: Record<string, string> = {};
  (panel?.boardingPoints ?? []).forEach(bp => { boardingPoints[bp.id] = bp.name ?? bp.id; });

  const filtered = useMemo(() => {
    return passengers.filter(p => {
      const status = checkinMap.get(p.id)?.status ?? "pending";
      if (filter !== "all" && status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.cpf ?? "").includes(q) && !(p.seatNumber ?? "").includes(q)) return false;
      }
      return true;
    });
  }, [passengers, checkinMap, filter, search]);

  async function handleCheckIn(passengerId: string, reservationId: string, status: "present" | "absent") {
    setPendingId(passengerId);
    try {
      const r = await fetch(`/api/trips/${tripId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passengerId, reservationId, status }),
      });
      if (!r.ok) throw new Error("Erro");
      await Promise.all([refetchCheckins(), refetchPanel()]);
    } catch {
      toast({ title: "Erro ao registrar check-in", variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }

  async function handleUndo(passengerId: string) {
    setPendingId(passengerId);
    try {
      await fetch(`/api/trips/${tripId}/checkins/${passengerId}`, { method: "DELETE", credentials: "include" });
      await Promise.all([refetchCheckins(), refetchPanel()]);
    } catch {
      toast({ title: "Erro ao desfazer", variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/trips/${tripId}/checkin-panel`)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Check-in de Embarque</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Progress value={progressPct} className="h-2 w-32" />
            <span className="text-sm text-muted-foreground font-medium">{checkedInCount}/{totalPassengers} embarcados</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchPanel(); refetchCheckins(); }}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white border-b px-4 py-3 flex gap-2 flex-wrap sticky top-[73px] z-10">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Nome, CPF ou poltrona..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-10" />
        </div>
        <div className="flex gap-1.5">
          {([
            ["all", "Todos"],
            ["pending", "Pendentes"],
            ["present", "Embarcados"],
            ["absent", "Ausentes"],
          ] as const).map(([key, label]) => (
            <Button key={key} variant={filter === key ? "default" : "outline"} size="sm"
              className="h-10 px-3" onClick={() => setFilter(key)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Passenger cards */}
      <div className="flex-1 p-4 space-y-2">
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">Carregando passageiros...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">Nenhum passageiro encontrado.</div>
        ) : (
          filtered.map(p => {
            const checkin = checkinMap.get(p.id);
            const status = checkin?.status === "present" ? "present" : checkin?.status === "absent" ? "absent" : "pending";
            const bp = p.boardingLocationId ? (boardingPoints[p.boardingLocationId] ?? null) : null;
            const isProcessing = pendingId === p.id;

            return (
              <div key={p.id}
                className={`bg-white rounded-xl border-2 px-5 py-4 flex items-center gap-4 transition-colors ${
                  status === "present" ? "border-green-400 bg-green-50/60" :
                  status === "absent" ? "border-red-400 bg-red-50/60" :
                  "border-gray-200"
                }`}
              >
                {/* Status icon */}
                <div className="shrink-0">
                  {status === "present" ? (
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  ) : status === "absent" ? (
                    <XCircle className="w-8 h-8 text-red-500" />
                  ) : (
                    <Clock className="w-8 h-8 text-gray-400" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-semibold leading-tight truncate">{p.name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5 text-sm text-muted-foreground">
                    {p.seatNumber && <span>Poltrona <strong>{p.seatNumber}</strong></span>}
                    {bp && <span>{bp}</span>}
                    {p.ageCategory && p.ageCategory !== "adult" && <span>{p.ageCategory === "child" ? "Criança" : p.ageCategory === "senior" ? "Idoso" : p.ageCategory}</span>}
                    {checkin?.checkedInAt && (
                      <span>{format(new Date(checkin.checkedInAt), "HH:mm", { locale: ptBR })}</span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 shrink-0">
                  {status !== "present" && (
                    <Button
                      className="h-14 px-6 text-base font-semibold bg-green-600 hover:bg-green-700 text-white gap-2"
                      disabled={isProcessing}
                      onClick={() => handleCheckIn(p.id, p.reservationId, "present")}
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      Embarcar
                    </Button>
                  )}
                  {status !== "absent" && (
                    <Button
                      className="h-14 px-6 text-base font-semibold bg-red-600 hover:bg-red-700 text-white gap-2"
                      disabled={isProcessing}
                      onClick={() => handleCheckIn(p.id, p.reservationId, "absent")}
                    >
                      <XCircle className="w-5 h-5" />
                      Ausente
                    </Button>
                  )}
                  {status !== "pending" && (
                    <Button variant="outline" className="h-14 px-4 text-sm"
                      disabled={isProcessing} onClick={() => handleUndo(p.id)}>
                      Desfazer
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
