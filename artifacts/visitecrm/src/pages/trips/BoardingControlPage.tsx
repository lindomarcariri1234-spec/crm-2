import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, RefreshCw, Bus, Users, CheckCircle2, XCircle, Clock, Navigation, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import "leaflet/dist/leaflet.css";

interface AbsentPassenger {
  id: string;
  name: string;
  seatNumber: string | null;
  boardingLocationId: string | null;
  boardingLocationName: string | null;
  isFree: boolean;
}

interface GuideLocation {
  lat: string;
  lng: string;
  guideName: string | null;
  updatedAt: string;
}

interface BoardingLiveData {
  tripId: string;
  tripName: string;
  status: string;
  checkedIn: number;
  absent: number;
  pending: number;
  total: number;
  absentPassengers: AbsentPassenger[];
  guideLocation: GuideLocation | null;
  boardingPoints: Array<{ id: string; name: string; time?: string }>;
}

export function BoardingControlPage({ tripId }: { tripId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [data, setData] = useState<BoardingLiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`/api/trips/${tripId}/boarding-live`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar dados");
      const json: BoardingLiveData = await r.json();
      setData(json);
    } catch {
      toast({ title: "Erro ao atualizar painel", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [tripId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const es = new EventSource(`/api/trips/${tripId}/boarding-live/stream`, { withCredentials: true });
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === "refresh") fetchData();
      } catch {
      }
    };
    es.onerror = () => {};
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [tripId, fetchData]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (!mapRef.current) return;
    let map: import("leaflet").Map | null = null;
    import("leaflet").then((L) => {
      if (!mapRef.current || leafletMapRef.current) return;
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      map = L.map(mapRef.current!).setView([-15.793, -47.882], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      leafletMapRef.current = map;
    });
    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!data?.guideLocation || !leafletMapRef.current) return;
    const { lat, lng } = data.guideLocation;
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (isNaN(latN) || isNaN(lngN)) return;

    import("leaflet").then((L) => {
      const map = leafletMapRef.current;
      if (!map) return;
      if (markerRef.current) {
        markerRef.current.setLatLng([latN, lngN]);
      } else {
        const busIcon = L.divIcon({
          html: `<div style="background:#1d4ed8;color:white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid white;">🚌</div>`,
          className: "",
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        markerRef.current = L.marker([latN, lngN], { icon: busIcon })
          .addTo(map)
          .bindPopup(data.guideLocation?.guideName ? `Guia: ${data.guideLocation.guideName}` : "Localização do guia");
        map.setView([latN, lngN], 14);
      }
    });
  }, [data?.guideLocation]);

  async function handleCheckIn(passenger: AbsentPassenger, status: "present" | "absent") {
    if (passenger.isFree) return;
    setCheckingIn(passenger.id);
    try {
      const r = await fetch(`/api/trips/${tripId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passengerId: passenger.id, status }),
      });
      if (!r.ok) throw new Error("Erro");
      await fetchData();
      toast({ title: status === "present" ? `${passenger.name} embarcou` : `${passenger.name} marcado como ausente` });
    } catch {
      toast({ title: "Erro ao registrar check-in", variant: "destructive" });
    } finally {
      setCheckingIn(null);
    }
  }

  const pct = data && data.total > 0 ? Math.round((data.checkedIn / data.total) * 100) : 0;
  const allBoarded = data ? data.checkedIn === data.total && data.total > 0 : false;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          className="text-gray-300 hover:text-white hover:bg-gray-800"
          onClick={() => navigate(`/trips/${tripId}`)}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <Bus className="w-5 h-5 text-blue-400" />
          <div>
            <h1 className="text-base font-semibold leading-tight">
              Central de Embarque{data?.tripName ? ` — ${data.tripName}` : ""}
            </h1>
            <p className="text-xs text-gray-400">Painel ao vivo · atualiza a cada 8s via SSE</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          onClick={fetchData}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {allBoarded && (
        <div className="bg-green-600 px-4 py-3 text-center">
          <p className="text-lg font-bold text-white flex items-center justify-center gap-2">
            <CheckCircle2 className="w-6 h-6" />
            Embarque completo — pode partir!
          </p>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden" style={{ minHeight: 0 }}>
        <div className="bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-gray-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-400">{loading ? "—" : data?.checkedIn ?? 0}</p>
                  <p className="text-xs text-gray-400">Embarcados</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-400">{loading ? "—" : data?.pending ?? 0}</p>
                  <p className="text-xs text-gray-400">Pendentes</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-red-400">{loading ? "—" : data?.absent ?? 0}</p>
                  <p className="text-xs text-gray-400">Ausentes</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-300">{loading ? "—" : data?.total ?? 0}</p>
                  <p className="text-xs text-gray-400">Total</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-3xl font-bold ${pct === 100 ? "text-green-400" : pct >= 80 ? "text-blue-400" : "text-amber-400"}`}>{pct}%</p>
                <p className="text-xs text-gray-400">embarque</p>
              </div>
            </div>
            <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-green-500" : pct >= 80 ? "bg-blue-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="p-3 border-b border-gray-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-300 font-medium">
              Pendentes / Ausentes ({(data?.absentPassengers ?? []).length})
            </span>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
            </div>
          ) : (data?.absentPassengers ?? []).length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
              <p className="text-lg font-semibold text-green-400">Todos embarcados!</p>
              <p className="text-sm text-gray-400">Nenhum passageiro pendente.</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
              {(data?.absentPassengers ?? []).map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.seatNumber && (
                        <span className="font-mono text-xs bg-gray-700 border border-gray-600 px-2 py-0.5 rounded font-bold text-gray-200">
                          {p.seatNumber}
                        </span>
                      )}
                      <span className="text-sm font-medium text-white">{p.name}</span>
                      {p.isFree && (
                        <Badge className="bg-purple-900/60 text-purple-300 border border-purple-700 text-xs">Gratuidade</Badge>
                      )}
                    </div>
                    {p.boardingLocationName && (
                      <p className="text-xs text-gray-400 mt-0.5">{p.boardingLocationName}</p>
                    )}
                  </div>
                  {!p.isFree && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 bg-green-700 hover:bg-green-600 text-white border-0 text-xs gap-1"
                        disabled={checkingIn === p.id}
                        onClick={() => handleCheckIn(p, "present")}
                      >
                        {checkingIn === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Embarcar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-red-700 text-red-400 hover:bg-red-900/40 text-xs gap-1"
                        disabled={checkingIn === p.id}
                        onClick={() => handleCheckIn(p, "absent")}
                      >
                        <XCircle className="w-3 h-3" />
                        Ausente
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col bg-gray-950 overflow-hidden">
          <div ref={mapRef} className="flex-1" style={{ minHeight: "300px" }} />

          <div className="bg-gray-900 border-t border-gray-800 p-3">
            {data?.guideLocation ? (
              <div className="flex items-start gap-2">
                <Navigation className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-white">
                    {data.guideLocation.guideName ? `Guia: ${data.guideLocation.guideName}` : "Localização do Guia"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Última atualização:{" "}
                    {format(new Date(data.guideLocation.updatedAt), "HH:mm:ss", { locale: ptBR })}
                    {" · "}
                    <a
                      href={`https://www.google.com/maps?q=${data.guideLocation.lat},${data.guideLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline hover:no-underline"
                    >
                      Abrir no Maps
                    </a>
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>Aguardando localização do guia...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
