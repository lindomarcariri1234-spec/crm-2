import { useState } from "react";
import {
  useGetNpsSummary,
  useListNpsResponses,
  useSendNpsSurvey,
  useGetMe,
  useGetTenant,
} from "@workspace/api-client-react";
import { useListTrips } from "@workspace/api-client-react";
import { useListClients } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Send,
  Star,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
  User,
  Bus,
  HeartHandshake,
  ClipboardList,
  PersonStanding,
} from "lucide-react";
import type { NpsResponse, NpsSendLink } from "@workspace/api-client-react";
import { formatDate } from "@/lib/utils";

const classConfig: Record<
  string,
  { label: string; icon: React.ReactNode; badge: string; score: string }
> = {
  promoter: {
    label: "Promotor",
    icon: <TrendingUp className="w-4 h-4 text-green-500" />,
    badge: "bg-green-100 text-green-800",
    score: "9-10",
  },
  passive: {
    label: "Neutro",
    icon: <Minus className="w-4 h-4 text-yellow-500" />,
    badge: "bg-yellow-100 text-yellow-800",
    score: "7-8",
  },
  detractor: {
    label: "Detrator",
    icon: <TrendingDown className="w-4 h-4 text-red-500" />,
    badge: "bg-red-100 text-red-800",
    score: "0-6",
  },
};

function NpsGauge({ score }: { score: number }) {
  const color =
    score >= 50
      ? "#22c55e"
      : score >= 0
      ? "#eab308"
      : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-36 h-36 rounded-full border-8 flex items-center justify-center"
        style={{ borderColor: color }}
      >
        <div className="text-center">
          <span
            className="text-4xl font-black"
            style={{ color }}
          >
            {score > 0 ? "+" : ""}
            {score}
          </span>
          <p className="text-xs text-muted-foreground font-medium">NPS</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {score >= 75
          ? "Excelente"
          : score >= 50
          ? "Muito Bom"
          : score >= 0
          ? "Bom"
          : "Precisa melhorar"}
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted transition-colors shrink-0"
      title="Copiar link"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

function ResponseDetail({
  response,
  onClose,
}: {
  response: NpsResponse;
  onClose: () => void;
}) {
  const cls = classConfig[response.classification] ?? {
    label: response.classification,
    icon: null,
    badge: "",
    score: "",
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Detalhe da Resposta NPS</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 mt-2">
        {response.clientName && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{response.clientName}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cls.icon}
            <Badge className={cls.badge} variant="secondary">
              {cls.label}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <Star
                key={i}
                className={`w-4 h-4 ${
                  i < response.score
                    ? "text-yellow-400 fill-yellow-400"
                    : "text-gray-200"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="text-center py-2">
          <span className="text-5xl font-black text-primary">
            {response.score}
          </span>
          <span className="text-lg text-muted-foreground">/10</span>
        </div>
        {response.feedback && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Comentário do cliente
            </p>
            <p className="text-sm">{response.feedback}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground text-right">
          Recebido em{" "}
          {new Date(response.createdAt).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

export default function Nps() {
  const [filterClass, setFilterClass] = useState("all");
  const [filterTrip, setFilterTrip] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState("");
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [sendMode, setSendMode] = useState<"all" | "select">("all");
  const [detailResponse, setDetailResponse] = useState<NpsResponse | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<NpsSendLink[]>([]);

  const { data: me } = useGetMe();
  const { data: tenantData } = useGetTenant(me?.tenantId ?? "", {
    query: { enabled: !!me?.tenantId, queryKey: ["tenant", me?.tenantId ?? ""] },
  });
  const npsCategories = ((tenantData?.settings as Record<string, unknown> | null | undefined)
    ?.npsCategories ?? null) as { transport?: boolean; service?: boolean; organization?: boolean; guide?: boolean } | null;

  const enabledNpsCatKeys = new Set<string>(
    (["transport", "service", "organization", "guide"] as const).filter(
      key => !npsCategories || npsCategories[key] !== false,
    ),
  );

  const summaryParams = {
    tripId: filterTrip !== "all" ? filterTrip : undefined,
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
  };
  const { data: summary, isLoading: loadingSummary } = useGetNpsSummary(
    summaryParams,
    { query: { queryKey: ["/api/nps/summary", summaryParams] } },
  );
  const listParams = {
    limit: 200,
    classification: filterClass === "all" ? undefined : filterClass,
    tripId: filterTrip !== "all" ? filterTrip : undefined,
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
  };
  const { data: responses, isLoading: loadingResponses } = useListNpsResponses(listParams);
  const { data: trips } = useListTrips({ limit: 100 });
  const { data: clients } = useListClients({ limit: 300 });

  const { mutate: sendNps, isPending: isSending } = useSendNpsSurvey({
    mutation: {
      onSuccess: (data) => {
        setGeneratedLinks(data.links ?? []);
      },
    },
  });

  const filteredResponses = responses ?? [];

  const handleSend = () => {
    if (!selectedTrip) return;
    sendNps({
      data: {
        tripId: selectedTrip,
        clientIds: sendMode === "select" ? selectedClientIds : undefined,
      },
    });
  };

  const handleCloseSend = () => {
    setIsSendOpen(false);
    setSelectedTrip("");
    setSelectedClientIds([]);
    setSendMode("all");
    setGeneratedLinks([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">NPS</h1>
          <p className="text-muted-foreground mt-1">
            Net Promoter Score — satisfação dos seus clientes.
          </p>
        </div>
        <Dialog open={isSendOpen} onOpenChange={(open) => { if (!open) handleCloseSend(); else setIsSendOpen(true); }}>

          <DialogTrigger asChild>
            <Button>
              <Send className="w-4 h-4 mr-2" /> Enviar Pesquisa
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Enviar Pesquisa NPS</DialogTitle>
            </DialogHeader>

            {generatedLinks.length > 0 ? (
              <div className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground">
                  Links gerados para {generatedLinks.length} cliente(s). Copie e envie via WhatsApp:
                </p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {generatedLinks.map((link) => (
                    <div
                      key={link.clientId}
                      className="p-3 rounded-lg border bg-muted/30 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{link.clientName}</span>
                        <CopyButton text={link.surveyUrl} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{link.surveyUrl}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleCloseSend}>Fechar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Viagem</label>
                  <Select value={selectedTrip} onValueChange={(v) => { setSelectedTrip(v); setSelectedClientIds([]); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar viagem..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(trips?.data ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} —{" "}
                          {formatDate(t.departureDate)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Destinatários</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setSendMode("all"); setSelectedClientIds([]); }}
                      className={`flex-1 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                        sendMode === "all"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-muted"
                      }`}
                    >
                      Todos os passageiros
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendMode("select")}
                      className={`flex-1 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                        sendMode === "select"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-muted"
                      }`}
                    >
                      Selecionar clientes
                    </button>
                  </div>
                </div>

                {sendMode === "select" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Clientes</label>
                    <div className="max-h-44 overflow-y-auto border rounded-lg divide-y">
                      {(clients?.data ?? []).map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={selectedClientIds.includes(c.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedClientIds((prev) => [...prev, c.id]);
                              } else {
                                setSelectedClientIds((prev) =>
                                  prev.filter((id) => id !== c.id)
                                );
                              }
                            }}
                          />
                          <span>{c.name}</span>
                          {c.phone && (
                            <span className="text-muted-foreground ml-auto">
                              {c.phone}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                    {selectedClientIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selectedClientIds.length} cliente(s) selecionado(s)
                      </p>
                    )}
                  </div>
                )}

                {sendMode === "all" && (
                  <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/50 border">
                    Serão gerados links individuais para todos os passageiros
                    da viagem selecionada.
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCloseSend}>
                    Cancelar
                  </Button>
                  <Button
                    disabled={
                      !selectedTrip ||
                      (sendMode === "select" && selectedClientIds.length === 0) ||
                      isSending
                    }
                    onClick={handleSend}
                  >
                    {isSending ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Gerando...
                      </span>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" /> Gerar Links
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-4 rounded-lg border bg-muted/30">
        <div className="flex flex-col gap-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground">Viagem</label>
          <Select value={filterTrip} onValueChange={setFilterTrip}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todas as viagens" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as viagens</SelectItem>
              {(trips?.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} — {formatDate(t.departureDate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">De</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Até</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {(filterTrip !== "all" || filterDateFrom || filterDateTo) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterTrip("all"); setFilterDateFrom(""); setFilterDateTo(""); }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {loadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      ) : summary ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Score Geral</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4 pt-2">
                <NpsGauge score={summary.npsScore} />
                <div className="w-full grid grid-cols-2 gap-3">
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <p className="text-xl font-bold">
                      {summary.averageScore.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">Média</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <p className="text-xl font-bold">{summary.total}</p>
                    <p className="text-xs text-muted-foreground">Respostas</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Distribuição</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                {[
                  {
                    type: "promoter" as const,
                    count: summary.promoters,
                    icon: <ThumbsUp className="w-4 h-4" />,
                    color: "bg-green-500",
                  },
                  {
                    type: "passive" as const,
                    count: summary.passives,
                    icon: <Minus className="w-4 h-4" />,
                    color: "bg-yellow-400",
                  },
                  {
                    type: "detractor" as const,
                    count: summary.detractors,
                    icon: <ThumbsDown className="w-4 h-4" />,
                    color: "bg-red-500",
                  },
                ].map(({ type, count, icon, color }) => {
                  const cfg = classConfig[type];
                  const pct =
                    summary.total > 0
                      ? ((count / summary.total) * 100).toFixed(0)
                      : "0";
                  return (
                    <div key={type} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span className={`p-0.5 rounded text-white ${color}`}>
                            {icon}
                          </span>
                          {cfg.label} ({cfg.score})
                        </span>
                        <span className="text-muted-foreground">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className={`${color} h-2 rounded-full transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {[
              { label: "Transporte", catKey: "transport", value: summary.avgTransport },
              { label: "Atendimento", catKey: "service", value: summary.avgService },
              { label: "Organização", catKey: "organization", value: summary.avgOrganization },
              { label: "Guia", catKey: "guide", value: summary.avgGuide },
            ].filter(c => enabledNpsCatKeys.has(c.catKey)).some(c => c.value != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Satisfação por Categoria</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Transporte", catKey: "transport", value: summary.avgTransport, icon: <Bus className="w-4 h-4" />, color: "text-blue-500" },
                    { label: "Atendimento", catKey: "service", value: summary.avgService, icon: <HeartHandshake className="w-4 h-4" />, color: "text-green-500" },
                    { label: "Organização", catKey: "organization", value: summary.avgOrganization, icon: <ClipboardList className="w-4 h-4" />, color: "text-purple-500" },
                    { label: "Guia", catKey: "guide", value: summary.avgGuide, icon: <PersonStanding className="w-4 h-4" />, color: "text-orange-500" },
                  ].filter(c => enabledNpsCatKeys.has(c.catKey)).map(({ label, value, icon, color }) => (
                    <div key={label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/50">
                      <span className={color}>{icon}</span>
                      <p className="text-xs text-muted-foreground font-medium">{label}</p>
                      {value != null ? (
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-2xl font-bold">{value.toFixed(1)}</span>
                          <span className="text-xs text-muted-foreground">/5</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                      {value != null && (
                        <div className="flex gap-0.5 mt-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${i < Math.round(value) ? "text-yellow-400 fill-yellow-400" : "text-gray-200"}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            Filtrar:
          </span>
          {["all", "promoter", "passive", "detractor"].map((cls) => (
            <button
              key={cls}
              onClick={() => setFilterClass(cls)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterClass === cls
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {cls === "all"
                ? "Todos"
                : classConfig[cls]?.label ?? cls}
            </button>
          ))}
        </div>

        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead>Comentário</TableHead>
                <TableHead>Data</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingResponses ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredResponses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Nenhuma resposta NPS encontrada.</p>
                    <p className="text-sm mt-1">
                      Envie uma pesquisa para coletar avaliações dos clientes.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredResponses.map((r) => {
                  const cls = classConfig[r.classification] ?? {
                    label: r.classification,
                    icon: null,
                    badge: "",
                  };
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.clientName ? (
                          <span className="text-sm font-medium">{r.clientName}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          {cls.icon}
                          <Badge className={cls.badge} variant="secondary">
                            {cls.label}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-lg">{r.score}</span>
                          <span className="text-muted-foreground text-sm">/10</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {r.feedback ? (
                          <p className="text-sm truncate">{r.feedback}</p>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            Sem comentário
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </TableCell>
                      <TableCell>
                        <Dialog
                          open={detailResponse?.id === r.id}
                          onOpenChange={(o) => !o && setDetailResponse(null)}
                        >
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDetailResponse(r)}
                            >
                              Ver
                            </Button>
                          </DialogTrigger>
                          {detailResponse?.id === r.id && (
                            <ResponseDetail
                              response={r}
                              onClose={() => setDetailResponse(null)}
                            />
                          )}
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
