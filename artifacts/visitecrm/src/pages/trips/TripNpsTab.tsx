import { useState } from "react";
import {
  useGetNpsSummary,
  useListNpsResponses,
  useSendNpsSurvey,
  useGetTrip,
  useGetMe,
  useGetTenant,
} from "@workspace/api-client-react";
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
  ChevronLeft,
  Copy,
  Check,
  Bus,
  HeartHandshake,
  ClipboardList,
  PersonStanding,
} from "lucide-react";
import type { NpsResponse, NpsSendLink } from "@workspace/api-client-react";
import { Link } from "wouter";

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
    score >= 50 ? "#22c55e" : score >= 0 ? "#eab308" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative w-32 h-32 rounded-full border-8 flex items-center justify-center"
        style={{ borderColor: color }}
      >
        <div className="text-center">
          <span className="text-3xl font-black" style={{ color }}>
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

function ScoreDetail({
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

  const subScores = [
    { label: "Transporte", value: response.scoreTransport },
    { label: "Atendimento", value: response.scoreService },
    { label: "Organização", value: response.scoreOrganization },
    { label: "Guia", value: response.scoreGuide },
  ].filter((s) => s.value != null);

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Avaliação NPS</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 mt-2">
        {response.clientName && (
          <div className="p-2 rounded-lg bg-muted/50 text-sm font-medium">
            {response.clientName}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cls.icon}
            <Badge className={cls.badge} variant="secondary">
              {cls.label}
            </Badge>
          </div>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Star
                key={i}
                className={`w-3.5 h-3.5 ${
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

        {subScores.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {subScores.map((s) => (
              <div
                key={s.label}
                className="p-2 rounded-lg bg-muted/50 text-center"
              >
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {response.feedback && (
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Comentário
            </p>
            <p className="text-sm">{response.feedback}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground text-right">
          {new Date(response.createdAt).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
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

export function TripNpsTab({ tripId }: { tripId: string }) {
  const [filterClass, setFilterClass] = useState("all");
  const [detailResponse, setDetailResponse] = useState<NpsResponse | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [generatedLinks, setGeneratedLinks] = useState<NpsSendLink[]>([]);

  const { data: me } = useGetMe();
  const tenantId = me?.tenantId ?? null;
  const { data: tenantData } = useGetTenant(tenantId ?? "", {
    query: { enabled: !!tenantId, queryKey: ["tenant", tenantId] },
  });
  const npsCategories = ((tenantData as (typeof tenantData & { settings?: Record<string, unknown> }))?.settings?.npsCategories ?? {}) as { transport?: boolean; service?: boolean; organization?: boolean; guide?: boolean };
  const isCategoryEnabled = (key: string) => (npsCategories as Record<string, boolean | undefined>)[key] !== false;

  const { data: trip } = useGetTrip(tripId, {
    query: { queryKey: ["/api/trips", tripId] },
  });

  const { data: summary, isLoading: loadingSummary } = useGetNpsSummary(
    { tripId },
    { query: { queryKey: ["/api/nps/summary", tripId] } },
  );

  const { data: responses, isLoading: loadingResponses } = useListNpsResponses(
    { tripId, limit: 200 },
    { query: { queryKey: ["/api/nps", tripId] } },
  );

  const { mutate: sendNps, isPending: isSending } = useSendNpsSurvey({
    mutation: {
      onSuccess: (data) => {
        setGeneratedLinks(data.links ?? []);
      },
    },
  });

  const handleSend = () => {
    sendNps({ data: { tripId } });
  };

  const handleCloseSend = () => {
    setSendOpen(false);
    setGeneratedLinks([]);
  };

  const filtered = (responses ?? []).filter(
    (r) => filterClass === "all" || r.classification === filterClass,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/trips/${tripId}`}>
            <Button variant="ghost" size="icon">
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-xl font-bold">NPS da Viagem</h2>
            {trip && (
              <p className="text-sm text-muted-foreground">{trip.name}</p>
            )}
          </div>
        </div>

        <Dialog
          open={sendOpen}
          onOpenChange={(open) => {
            if (!open) handleCloseSend();
            else setSendOpen(true);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Send className="w-4 h-4 mr-2" /> Enviar Pesquisa
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar Pesquisa NPS</DialogTitle>
            </DialogHeader>
            {generatedLinks.length > 0 ? (
              <div className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground">
                  Links gerados para {generatedLinks.length} passageiro(s):
                </p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {generatedLinks.map((link) => (
                    <div
                      key={link.clientId}
                      className="p-3 rounded-lg border bg-muted/30 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {link.clientName}
                        </span>
                        <CopyButton text={link.surveyUrl} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {link.surveyUrl}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleCloseSend}>Fechar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/50 border">
                  Serão gerados links individuais para todos os passageiros
                  desta viagem.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCloseSend}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSend} disabled={isSending}>
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

      {loadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : summary ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Score desta Viagem</CardTitle>
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

          {[summary.avgTransport, summary.avgService, summary.avgOrganization, summary.avgGuide].some(v => v != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Satisfação por Categoria</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Transporte", key: "transport", value: summary.avgTransport, icon: <Bus className="w-4 h-4" />, color: "text-blue-500" },
                    { label: "Atendimento", key: "service", value: summary.avgService, icon: <HeartHandshake className="w-4 h-4" />, color: "text-green-500" },
                    { label: "Organização", key: "organization", value: summary.avgOrganization, icon: <ClipboardList className="w-4 h-4" />, color: "text-purple-500" },
                    { label: "Guia", key: "guide", value: summary.avgGuide, icon: <PersonStanding className="w-4 h-4" />, color: "text-orange-500" },
                  ].filter(({ key }) => isCategoryEnabled(key)).map(({ label, value, icon, color }) => (
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
              {cls === "all" ? "Todos" : classConfig[cls]?.label ?? cls}
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
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Nenhuma avaliação NPS ainda.</p>
                    <p className="text-sm mt-1">
                      Envie uma pesquisa para coletar avaliações desta viagem.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const cls = classConfig[r.classification] ?? {
                    label: r.classification,
                    icon: null,
                    badge: "",
                  };
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.clientName ? (
                          <span className="text-sm font-medium">
                            {r.clientName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            —
                          </span>
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
                          <span className="text-muted-foreground text-sm">
                            /10
                          </span>
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
                        {new Date(r.createdAt).toLocaleDateString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}
                      </TableCell>
                      <TableCell>
                        <Dialog
                          open={detailResponse?.id === r.id}
                          onOpenChange={(o) =>
                            !o && setDetailResponse(null)
                          }
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDetailResponse(r)}
                            >
                              Ver
                            </Button>
                          </DialogTrigger>
                          {detailResponse?.id === r.id && (
                            <ScoreDetail
                              response={detailResponse}
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
