import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Crown, Download, Users, Share2, Trophy, Medal, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FullRankingEntry {
  rank: number;
  clientId: string | null;
  name: string;
  email: string;
  ambassadorOptIn: boolean;
  count: number;
}

interface FullRankingResponse {
  referrers: FullRankingEntry[];
  travelers: FullRankingEntry[];
  month: string;
}

async function fetchFullRanking(): Promise<FullRankingResponse> {
  const res = await fetch(`${BASE}/api/club/ranking/full`, { credentials: "include" });
  if (!res.ok) throw new Error("Erro ao carregar ranking");
  return res.json() as Promise<FullRankingResponse>;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>;
  if (rank === 2) return <span className="text-lg">🥈</span>;
  if (rank === 3) return <span className="text-lg">🥉</span>;
  return <span className="text-sm font-bold text-muted-foreground w-6 text-center">#{rank}</span>;
}

function RankingTable({
  title,
  icon,
  data,
  countLabel,
}: {
  title: string;
  icon: React.ReactNode;
  data: FullRankingEntry[];
  countLabel: string;
}) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado disponível para o mês atual.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {data.map((entry) => (
            <div key={entry.clientId ?? entry.name} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors">
              <div className="w-8 flex justify-center shrink-0">
                <RankBadge rank={entry.rank} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{entry.name}</p>
                <p className="text-xs text-muted-foreground truncate">{entry.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="tabular-nums">
                  {entry.count} {countLabel}
                </Badge>
                {entry.ambassadorOptIn ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Crown className="w-3 h-3" />
                    Embaixador
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Privado
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmbaixadoresPage() {
  const { toast } = useToast();
  const [data, setData] = useState<FullRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await fetchFullRanking();
      setData(result);
    } catch {
      toast({ title: "Erro ao carregar ranking", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleExportCsv() {
    window.open(`${BASE}/api/club/ranking/full?export=csv`, "_blank");
  }

  const monthLabel = data?.month
    ? new Date(data.month + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" })
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="w-6 h-6 text-amber-500" />
            <h1 className="text-2xl font-bold">Embaixadores</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ranking completo de indicadores e viajantes
            {monthLabel ? ` — ${monthLabel}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-1.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                {[...Array(5)].map((_, j) => (
                  <Skeleton key={j} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-amber-100">
                    <Trophy className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Top Indicador</p>
                    <p className="font-semibold text-sm">{data?.referrers[0]?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{data?.referrers[0]?.count ?? 0} indicações</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-blue-100">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Top Viajante</p>
                    <p className="font-semibold text-sm">{data?.travelers[0]?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{data?.travelers[0]?.count ?? 0} viagens</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-100">
                    <Crown className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Embaixadores Ativos</p>
                    <p className="font-semibold text-sm">
                      {new Set([
                        ...(data?.referrers ?? []).filter((r) => r.ambassadorOptIn).map((r) => r.clientId),
                        ...(data?.travelers ?? []).filter((r) => r.ambassadorOptIn).map((r) => r.clientId),
                      ]).size}
                    </p>
                    <p className="text-xs text-muted-foreground">no ranking público</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <RankingTable
              title="Top Indicadores do Mês"
              icon={<Share2 className="w-4 h-4 text-muted-foreground" />}
              data={data?.referrers ?? []}
              countLabel="indicações"
            />
            <RankingTable
              title="Top Viajantes do Mês"
              icon={<Medal className="w-4 h-4 text-muted-foreground" />}
              data={data?.travelers ?? []}
              countLabel="viagens"
            />
          </div>

          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">
                <strong>Notas:</strong> O ranking inclui todos os clientes do mês atual, independente do opt-in. 
                No portal do cliente, apenas clientes com "Embaixador" ativo aparecem no ranking público, com nomes mascarados (ex: "Maria S."). 
                O ranking atualiza diariamente.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
