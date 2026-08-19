import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetTripBoardingPanel } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, RefreshCw, Navigation, Smartphone, CheckCircle2, XCircle, Clock, Copy, Check } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface CheckinRecord {
  passengerId: string;
  status: string;
  checkedInAt: string;
  checkedInByUserRef: string | null;
  notes: string | null;
}

interface GuideLocation {
  lat: string;
  lng: string;
  guideName: string | null;
  recordedAt: string;
}

function StatusBadge({ status }: { status: "present" | "absent" | "pending" }) {
  if (status === "present") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle2 className="w-3 h-3 mr-1" />Embarcado</Badge>;
  if (status === "absent") return <Badge className="bg-red-100 text-red-800 hover:bg-red-100"><XCircle className="w-3 h-3 mr-1" />Ausente</Badge>;
  return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
}

export function TripCheckinPanel({ tripId }: { tripId: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [guideNameInput, setGuideNameInput] = useState("");
  const [generatedToken, setGeneratedToken] = useState<{ token: string; expiresAt: string; tripName: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "present" | "absent">("all");
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  const { data: panel, isLoading, refetch: refetchPanel } = useGetTripBoardingPanel(tripId, {
    query: { queryKey: ["boarding-panel-checkin", tripId], refetchInterval: 15000 },
  });

  const { data: checkinsData, refetch: refetchCheckins } = useQuery<{ data: CheckinRecord[] }>({
    queryKey: ["trip-checkins", tripId],
    queryFn: async () => {
      const r = await fetch(`/api/trips/${tripId}/checkins`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 15000,
  });

  const { data: locationData, refetch: refetchLocation } = useQuery<{ location: GuideLocation | null }>({
    queryKey: ["trip-guide-location", tripId],
    queryFn: async () => {
      const r = await fetch(`/api/trips/${tripId}/location`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 15000,
  });

  const checkinMap = useMemo(() =>
    new Map((checkinsData?.data ?? []).map(c => [c.passengerId, c])),
    [checkinsData?.data]
  );

  const passengers = panel?.passengers ?? [];
  const totalPassengers = panel?.totalPassengers ?? 0;
  const checkedInCount = useMemo(() =>
    passengers.filter(p => checkinMap.get(p.id)?.status === "present").length,
    [passengers, checkinMap]
  );
  const absentCount = useMemo(() =>
    passengers.filter(p => checkinMap.get(p.id)?.status === "absent").length,
    [passengers, checkinMap]
  );
  const progressPct = totalPassengers > 0 ? Math.round((checkedInCount / totalPassengers) * 100) : 0;
  const location = locationData?.location ?? null;
  const boardingPoints: Record<string, string> = {};
  (panel?.boardingPoints ?? []).forEach(bp => { boardingPoints[bp.id] = bp.name ?? bp.id; });

  const filtered = useMemo(() => {
    return passengers.filter(p => {
      const checkin = checkinMap.get(p.id);
      const status = checkin?.status === "present" ? "present" : checkin?.status === "absent" ? "absent" : "pending";
      if (filter !== "all" && status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.cpf ?? "").includes(q)) return false;
      }
      return true;
    });
  }, [passengers, checkinMap, filter, search]);

  async function handleCheckIn(passengerId: string, reservationId: string, status: "present" | "absent") {
    setCheckingIn(passengerId);
    try {
      const r = await fetch(`/api/trips/${tripId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passengerId, reservationId, status }),
      });
      if (!r.ok) throw new Error("Erro ao registrar check-in");
      await Promise.all([refetchCheckins(), refetchPanel()]);
    } catch {
      toast({ title: "Erro ao registrar check-in", variant: "destructive" });
    } finally {
      setCheckingIn(null);
    }
  }

  async function handleUndo(passengerId: string) {
    setCheckingIn(passengerId);
    try {
      await fetch(`/api/trips/${tripId}/checkins/${passengerId}`, { method: "DELETE", credentials: "include" });
      await Promise.all([refetchCheckins(), refetchPanel()]);
    } catch {
      toast({ title: "Erro ao desfazer check-in", variant: "destructive" });
    } finally {
      setCheckingIn(null);
    }
  }

  async function generateToken() {
    if (!guideNameInput.trim()) return;
    setGenerating(true);
    try {
      const r = await fetch(`/api/trips/${tripId}/guide-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ guideName: guideNameInput.trim() }),
      });
      if (!r.ok) throw new Error("Erro ao gerar código");
      const data = await r.json();
      setGeneratedToken(data);
    } catch {
      toast({ title: "Erro ao gerar código de guia", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function copyCode() {
    if (!generatedToken) return;
    navigator.clipboard.writeText(generatedToken.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resetTokenModal() {
    setGuideNameInput("");
    setGeneratedToken(null);
    setTokenModalOpen(false);
  }

  function refetchAll() {
    refetchPanel();
    refetchCheckins();
    refetchLocation();
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/trips/${tripId}`)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Check-in ao Vivo</h1>
          <p className="text-sm text-muted-foreground">Painel em tempo real — atualiza a cada 15s</p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="w-4 h-4 mr-2" />Atualizar
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/trips/${tripId}/checkin`)}>
          <Smartphone className="w-4 h-4 mr-2" />Modo Tablet
        </Button>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{checkedInCount}<span className="text-lg font-normal text-muted-foreground">/{totalPassengers}</span></p>
              <p className="text-sm text-muted-foreground">passageiros embarcados</p>
            </div>
            <div className="text-right text-sm text-muted-foreground space-y-0.5">
              <p><span className="font-medium text-red-600">{absentCount}</span> ausentes</p>
              <p><span className="font-medium">{totalPassengers - checkedInCount - absentCount}</span> pendentes</p>
            </div>
          </div>
          <Progress value={progressPct} className="h-3" />
          <p className="text-xs text-muted-foreground text-right">{progressPct}% embarcado</p>
        </CardContent>
      </Card>

      {/* Guide location */}
      {location && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <Navigation className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Localização do Guia{location.guideName ? ` — ${location.guideName}` : ""}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Última atualização: {format(new Date(location.recordedAt), "HH:mm:ss", { locale: ptBR })}
                </p>
                <a
                  href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 underline hover:no-underline mt-1 inline-block"
                >
                  {location.lat}, {location.lng} — Abrir no Google Maps
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setTokenModalOpen(true)} className="gap-2">
          <Smartphone className="w-4 h-4" />Gerar Código de Acesso para Guia
        </Button>
      </div>

      <Separator />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar passageiro..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-64" />
        {(["all", "pending", "present", "absent"] as const).map(f => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "Todos" : f === "pending" ? "Pendentes" : f === "present" ? "Embarcados" : "Ausentes"}
          </Button>
        ))}
      </div>

      {/* Passenger list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum passageiro encontrado.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const checkin = checkinMap.get(p.id);
            const status = checkin?.status === "present" ? "present" : checkin?.status === "absent" ? "absent" : "pending";
            const bp = p.boardingLocationId ? (boardingPoints[p.boardingLocationId] ?? p.boardingLocationId) : null;
            const isLoading = checkingIn === p.id;

            return (
              <Card key={p.id} className={`border ${status === "present" ? "border-green-200 bg-green-50/40" : status === "absent" ? "border-red-200 bg-red-50/40" : ""}`}>
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.seatNumber ? `Poltrona ${p.seatNumber}` : ""}
                      {bp ? ` • ${bp}` : ""}
                    </p>
                    {checkin?.checkedInAt && (
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(checkin.checkedInAt), "HH:mm", { locale: ptBR })}
                        {checkin.checkedInByUserRef ? ` — ${checkin.checkedInByUserRef.startsWith("guide:") ? "Guia" : "Staff"}` : ""}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={status} />
                  <div className="flex gap-1 shrink-0">
                    {status !== "present" && (
                      <Button size="sm" variant="outline" className="h-7 text-green-700 border-green-300 hover:bg-green-50"
                        disabled={isLoading} onClick={() => handleCheckIn(p.id, p.reservationId, "present")}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Embarcar
                      </Button>
                    )}
                    {status !== "absent" && (
                      <Button size="sm" variant="outline" className="h-7 text-red-700 border-red-300 hover:bg-red-50"
                        disabled={isLoading} onClick={() => handleCheckIn(p.id, p.reservationId, "absent")}>
                        <XCircle className="w-3.5 h-3.5 mr-1" />Ausente
                      </Button>
                    )}
                    {status !== "pending" && (
                      <Button size="sm" variant="ghost" className="h-7 text-muted-foreground"
                        disabled={isLoading} onClick={() => handleUndo(p.id)}>
                        Desfazer
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Guide token modal */}
      <Dialog open={tokenModalOpen} onOpenChange={open => { if (!open) resetTokenModal(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Código de Acesso para Guia</DialogTitle>
          </DialogHeader>
          {!generatedToken ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Gere um código de 8 caracteres válido por 24 horas. O guia insere este código no aplicativo para acessar o check-in desta viagem.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="guide-name">Nome do Guia</Label>
                <Input id="guide-name" placeholder="Ex: João Silva" value={guideNameInput}
                  onChange={e => setGuideNameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && generateToken()} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetTokenModal}>Cancelar</Button>
                <Button onClick={generateToken} disabled={!guideNameInput.trim() || generating}>
                  {generating ? "Gerando..." : "Gerar Código"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Compartilhe o código abaixo com <strong>{guideNameInput}</strong>. Válido até{" "}
                {format(new Date(generatedToken.expiresAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}.
              </p>
              <div className="bg-muted rounded-lg p-6 text-center">
                <p className="text-4xl font-mono font-bold tracking-widest text-foreground letter-spacing-8">
                  {generatedToken.token}
                </p>
              </div>
              <Button className="w-full gap-2" variant="outline" onClick={copyCode}>
                {copied ? <><Check className="w-4 h-4" />Copiado!</> : <><Copy className="w-4 h-4" />Copiar Código</>}
              </Button>
              <Button className="w-full" onClick={resetTokenModal}>Fechar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
