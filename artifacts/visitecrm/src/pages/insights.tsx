import { useState, useRef, useEffect } from "react";
import {
  useGetInsightsSummary,
  useGetRevenueForecast,
  useGetOccupancyRisk,
  useRunSimulator,
  useGetMe,
  useGetSalesCycle,
} from "@workspace/api-client-react";
import type { GetInsightsSummaryPeriod, GetSalesCyclePeriod } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp, TrendingDown, Minus,
  DollarSign, Users, Target, BarChart2, Map, Star, BrainCircuit,
  ShoppingCart, Zap, Package, Heart, Globe,
  ArrowUpRight, ArrowDownRight, Mail, Send, MousePointerClick, CheckCircle2,
  Repeat2, UserCheck, Award, Navigation, Bot, MessageCircle, X, ChevronUp,
  Sparkles, SlidersHorizontal, AlertTriangle, Loader2, RefreshCw, Plus,
  FileText, Copy, Printer, Check, Clock,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "@/lib/recharts-compat";
import { Slider } from "@/components/ui/slider";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";

const fmt = (v: number) => formatCurrency(v);
const fmtCompact = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return fmt(v);
};
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtNum = (v: number) => String(Math.round(v));

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function GrowthBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  const isPositive = value >= 0;
  return (
    <Badge variant="secondary" className={isPositive ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}>
      {isPositive ? "+" : ""}{value.toFixed(1)}%
    </Badge>
  );
}

function VariationBadge({ curr, prev, invert = false }: { curr: number; prev: number | null; invert?: boolean }) {
  if (prev === null || prev === 0) return null;
  const delta = ((curr - (prev ?? 0)) / Math.abs(prev)) * 100;
  const isPositive = invert ? delta < 0 : delta >= 0;
  const color = isPositive ? "text-emerald-600 bg-emerald-50" : "text-red-600 bg-red-50";
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  if (Math.abs(delta) < 0.05) return <span className="text-xs text-muted-foreground ml-1">—</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ml-1.5 ${color}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  prev,
  prevValue,
  sub,
  color,
  loading,
  invert,
  format = "compact",
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  prev?: number | null;
  prevValue?: string;
  sub?: string;
  color: string;
  loading?: boolean;
  invert?: boolean;
  format?: "compact" | "currency" | "pct" | "num";
}) {
  const display =
    format === "pct" ? fmtPct(value) :
    format === "num" ? fmtNum(value) :
    format === "currency" ? fmt(value) :
    fmtCompact(value);

  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`mt-1 p-2 rounded-md bg-muted ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-28 mt-1" />
          ) : (
            <div className="flex items-center flex-wrap mt-0.5">
              <p className="text-xl font-bold">{display}</p>
              {prev != null && <VariationBadge curr={value} prev={prev} invert={invert} />}
            </div>
          )}
          {sub && !loading && (
            <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
          )}
          {prevValue && !loading && (
            <p className="text-xs text-muted-foreground mt-0.5">Período anterior: {prevValue}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function NpsCard({ averageNps, averageNpsPrev }: { averageNps: number | null | undefined; averageNpsPrev: number | null | undefined }) {
  if (averageNps == null) return null;
  const nps = Number(averageNps);
  const npsPrev = averageNpsPrev != null ? Number(averageNpsPrev) : null;
  const color = nps >= 70 ? "bg-green-500" : nps >= 50 ? "bg-yellow-500" : "bg-red-500";
  const label = nps >= 70 ? "Excelente" : nps >= 50 ? "Bom" : "A melhorar";
  const textColor = nps >= 70 ? "text-green-600" : nps >= 50 ? "text-yellow-600" : "text-red-600";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="w-4 h-4" /> NPS — Net Promoter Score
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-6">
        <div>
          <p className="text-5xl font-bold">{nps.toFixed(0)}</p>
          <p className={`text-sm font-medium mt-1 ${textColor}`}>{label}</p>
          {npsPrev != null && (
            <p className="text-xs text-muted-foreground mt-1">Anterior: {npsPrev.toFixed(0)} pontos</p>
          )}
        </div>
        <div className="flex-1">
          <div className="w-full bg-muted rounded-full h-3">
            <div className={`h-3 rounded-full ${color}`} style={{ width: `${Math.min(nps, 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">Escala de 0 a 100 pontos</p>
        </div>
      </CardContent>
    </Card>
  );
}

const PERIOD_LABELS: Record<string, string> = {
  month: "mês anterior",
  quarter: "trimestre anterior",
  year: "ano anterior",
};

const SUGGESTED_QUESTIONS = [
  "Qual a saúde financeira da agência neste período?",
  "Qual campanha teve melhor desempenho?",
  "Qual viagem tem risco de baixa ocupação?",
  "Como está a taxa de retenção de clientes?",
  "Quais clientes têm maior potencial de recompra?",
  "Qual é a previsão de faturamento para os próximos 90 dias?",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const REPORT_PROMPT =
  "Gere um relatório executivo completo do período cobrindo todos os 7 pilares do negócio, com resumo executivo, principais riscos, principais oportunidades e 3 ações recomendadas.";

function printReport(content: string) {
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) return;
  const safe = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  win.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />` +
    `<title>Relatório do Período — VisiteCRM</title>` +
    `<style>` +
    `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;` +
    `color:#1a1a1a;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.6;}` +
    `pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:14px;margin:0;}` +
    `@media print{body{margin:0;padding:24px;}}` +
    `</style></head><body><pre>${safe}</pre>` +
    `<script>window.onload=function(){window.print();}</script>` +
    `</body></html>`,
  );
  win.document.close();
}

function StreamingChat({
  endpoint,
  extraBody,
  emptyIcon: EmptyIcon = Bot,
  emptyTitle,
  emptySubtitle,
  suggestions,
  placeholder,
  heightClass = "h-[540px]",
  enableReport = false,
}: {
  endpoint: string;
  extraBody?: Record<string, unknown>;
  emptyIcon?: React.ElementType;
  emptyTitle: string;
  emptySubtitle: string;
  suggestions: string[];
  placeholder: string;
  heightClass?: string;
  enableReport?: boolean;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tenantId = me?.tenantId ?? "anon";
  const userId = me?.id ?? "anon-user";
  const storageKey = `visitecrm:insights-chat:${tenantId}:${userId}:${endpoint}`;
  const loadedKeyRef = useRef<string | null>(null);
  const chatType = endpoint.includes("/ask") ? "executive" : "tourism";

  // Restore persisted history: server first (cross-device), fallback to localStorage.
  useEffect(() => {
    if (loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;
    let cancelled = false;

    async function loadHistory() {
      // Try server when tenant is known — treat OK response as authoritative
      // (even empty array means "no history", so skip localStorage fallback)
      if (tenantId !== "anon") {
        try {
          const token = await getToken();
          const res = await fetch(`/api/insights/history/${chatType}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok && !cancelled) {
            const data = (await res.json()) as { messages: ChatMessage[] };
            // Server is authoritative: set whatever it returns (may be [])
            setMessages(Array.isArray(data.messages) ? data.messages : []);
            return; // do NOT fall back to localStorage when server responded
          }
          // non-OK response — fall through to localStorage offline fallback
        } catch {
          // server unavailable — fall through to localStorage offline fallback
        }
      }
      // Fallback: localStorage (only reached when server is unreachable or non-OK)
      if (!cancelled) {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            const parsed = JSON.parse(saved) as ChatMessage[];
            if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
          }
        } catch {
          // ignore corrupt or unavailable storage
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [storageKey, tenantId, chatType, getToken]);

  // Persist completed conversation (skip mid-stream partials).
  useEffect(() => {
    if (isStreaming) return;
    // localStorage — offline fallback
    try {
      if (messages.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(messages));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // ignore storage quota / availability errors
    }
    // Server sync — fire-and-forget (cross-device persistence)
    if (messages.length > 0 && tenantId !== "anon") {
      void (async () => {
        try {
          const token = await getToken();
          await fetch(`/api/insights/history/${chatType}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ messages }),
          });
        } catch {
          // ignore — localStorage already has the data
        }
      })();
    }
  }, [messages, isStreaming, storageKey, tenantId, chatType, getToken]);

  function clearConversation() {
    setMessages([]);
    setInput("");
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    // Server delete — fire-and-forget
    if (tenantId !== "anon") {
      void (async () => {
        try {
          const token = await getToken();
          await fetch(`/api/insights/history/${chatType}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // ignore
        }
      })();
    }
  }

  function generateReport() {
    if (isStreaming) return;
    void sendMessage(REPORT_PROMPT, { mode: "report" });
  }

  async function copyMessage(content: string, idx: number) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 2000);
      toast({ title: "Relatório copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  async function sendMessage(content: string, overrideBody?: Record<string, unknown>) {
    if (!content.trim() || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content: content.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const token = await getToken();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: nextMessages, ...(extraBody ?? {}), ...(overrideBody ?? {}) }),
      });

      if (response.status === 429) {
        const retryAfterSec = Number(response.headers.get("Retry-After"));
        const minutes = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.max(1, Math.ceil(retryAfterSec / 60))
          : 1;
        const limitMsg = `Limite de perguntas atingido. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.`;
        toast({
          title: "Limite de perguntas atingido",
          description: `Você fez muitas perguntas em pouco tempo. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.`,
          variant: "destructive",
        });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: `⚠️ ${limitMsg}` };
          return updated;
        });
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as { content?: string; done?: boolean; error?: string };
            if (parsed.error) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: `⚠️ ${parsed.error}` };
                return updated;
              });
            } else if (parsed.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.content };
                }
                return updated;
              });
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: "⚠️ Não foi possível conectar ao assistente. Tente novamente." };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={`flex flex-col ${heightClass}`}>
      {!isEmpty && (
        <div className="flex justify-end gap-1 border-b px-4 py-2">
          {enableReport && (
            <Button
              variant="ghost"
              size="sm"
              onClick={generateReport}
              disabled={isStreaming}
              className="gap-1.5 text-muted-foreground"
            >
              <FileText className="w-3.5 h-3.5" />
              Gerar relatório do período
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearConversation}
            disabled={isStreaming}
            className="gap-1.5 text-muted-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova conversa
          </Button>
        </div>
      )}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-4">
          <div className="p-4 rounded-full bg-primary/10">
            <EmptyIcon className="w-10 h-10 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold">{emptyTitle}</p>
            <p className="text-sm text-muted-foreground mt-1">{emptySubtitle}</p>
          </div>
          {enableReport && (
            <Button onClick={generateReport} disabled={isStreaming} className="gap-2">
              <FileText className="w-4 h-4" />
              Gerar relatório do período
            </Button>
          )}
          <div className="flex flex-wrap gap-2 justify-center max-w-xl">
            {suggestions.map((q) => (
              <button
                key={q}
                onClick={() => void sendMessage(q)}
                className="text-xs border rounded-full px-3 py-1.5 hover:bg-primary/5 hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((msg, i) => {
            const showActions =
              msg.role === "assistant" && msg.content.trim().length > 0 &&
              !(isStreaming && i === messages.length - 1);
            return (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}>
                <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted text-foreground rounded-tl-sm"
                }`}>
                  {msg.content || (isStreaming && i === messages.length - 1 ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  ) : "")}
                </div>
                {showActions && (
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => void copyMessage(msg.content, i)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                    >
                      {copiedIdx === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedIdx === i ? "Copiado" : "Copiar"}
                    </button>
                    <button
                      onClick={() => setReportContent(msg.content)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                    >
                      <Printer className="w-3 h-3" />
                      Imprimir / PDF
                    </button>
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                  <Users className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              )}
            </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {!isEmpty && messages.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 3).map((q) => (
              <button
                key={q}
                onClick={() => void sendMessage(q)}
                disabled={isStreaming}
                className="text-xs border rounded-full px-2.5 py-1 hover:bg-primary/5 hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t px-4 py-3 flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-h-[40px] max-h-[120px] resize-none text-sm"
          rows={1}
          disabled={isStreaming}
        />
        <Button
          size="icon"
          onClick={() => void sendMessage(input)}
          disabled={!input.trim() || isStreaming}
          className="shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={reportContent !== null} onOpenChange={(open) => { if (!open) setReportContent(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Relatório do Período
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto rounded-md border bg-muted/30 p-5">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {reportContent}
            </pre>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => reportContent && void copyMessage(reportContent, -1)}
              className="gap-1.5"
            >
              {copiedIdx === -1 ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedIdx === -1 ? "Copiado" : "Copiar"}
            </Button>
            <Button onClick={() => reportContent && printReport(reportContent)} className="gap-1.5">
              <Printer className="w-4 h-4" />
              Imprimir / Salvar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const EXECUTIVE_QUESTIONS = [
  "Resuma a saúde financeira da agência para a diretoria.",
  "Onde estão os maiores riscos de receita nos próximos meses?",
  "Quais alavancas devo priorizar para aumentar a margem?",
  "Como está o fluxo de caixa e a inadimplência?",
  "Qual a tendência de crescimento e o que a sustenta?",
  "Que decisões tomar para melhorar a ocupação das viagens?",
];

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtMonthLabel(m: string): string {
  const [y, mo] = m.split("-");
  const idx = Number(mo) - 1;
  if (!y || idx < 0 || idx > 11) return m;
  return `${MONTH_NAMES[idx]}/${y.slice(2)}`;
}

function fmtDateBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}

const RISK_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  red: { label: "Alto risco", badge: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500" },
  yellow: { label: "Atenção", badge: "text-yellow-700 bg-yellow-50 border-yellow-200", dot: "bg-yellow-500" },
  green: { label: "Saudável", badge: "text-green-700 bg-green-50 border-green-200", dot: "bg-green-500" },
};

const HORIZON_TO_MONTHS: Record<string, number> = { "30": 1, "60": 2, "90": 3 };

// ─── Sales Cycle Tab ──────────────────────────────────────────────────────────

const SC_PERIOD_LABELS: Record<GetSalesCyclePeriod, string> = {
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  "12m": "Últimos 12 meses",
};

function fmtDays(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} dias`;
}

function SalesCycleTab() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const [cyclePeriod, setCyclePeriod] = useState<GetSalesCyclePeriod>(() => {
    const period = new URLSearchParams(searchStr).get("period");
    return period === "30d" || period === "90d" || period === "12m" ? period : "12m";
  });
  const [cycleChannel, setCycleChannel] = useState<string | undefined>(() => {
    const channel = new URLSearchParams(searchStr).get("channel");
    return channel || undefined;
  });
  const [cycleSeller, setCycleSeller] = useState<string | undefined>(() => {
    const seller = new URLSearchParams(searchStr).get("seller");
    return seller || undefined;
  });
  // Keep all channel options from the latest unfiltered byChannel payload
  const [channelOptions, setChannelOptions] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const period = params.get("period");
    const channel = params.get("channel");
    const seller = params.get("seller");
    setCyclePeriod(period === "30d" || period === "90d" || period === "12m" ? period : "12m");
    setCycleChannel(channel || undefined);
    setCycleSeller(seller || undefined);
  }, [searchStr]);

  function updateCycleFilters(next: { period?: GetSalesCyclePeriod; channel?: string; seller?: string }) {
    const params = new URLSearchParams(searchStr);
    const period = next.period ?? cyclePeriod;
    const hasChannelUpdate = Object.prototype.hasOwnProperty.call(next, "channel");
    const hasSellerUpdate = Object.prototype.hasOwnProperty.call(next, "seller");
    const channel = hasChannelUpdate ? next.channel : cycleChannel;
    const seller = hasSellerUpdate ? next.seller : cycleSeller;
    params.set("period", period);
    if (channel) {
      params.set("channel", channel);
    } else {
      params.delete("channel");
    }
    if (seller) {
      params.set("seller", seller);
    } else {
      params.delete("seller");
    }
    navigate(`?${params.toString()}`);
  }

  const { data, isLoading, isError, refetch, isFetching } = useGetSalesCycle({
    period: cyclePeriod,
    ...(cycleChannel !== undefined ? { channel: cycleChannel } : {}),
    ...(cycleSeller !== undefined ? { seller: cycleSeller } : {}),
  });

  // Update channel options whenever byChannel grows — byChannel is never filtered by channel param
  // so all channels always appear there regardless of which trend channel is selected.
  useEffect(() => {
    if (!data?.byChannel.length) return;
    setChannelOptions(data.byChannel.map((c: { origin: string }) => c.origin));
  }, [data?.byChannel]);

  const trendData = (data?.trend ?? []).map((t: { month: string; avgDaysToPayment: number | null; avgDaysToTrip: number | null }) => ({
    month: fmtMonthLabel(t.month),
    pagamento: t.avgDaysToPayment,
    viagem: t.avgDaysToTrip,
  }));

  const hasPaymentData = (data?.avgDaysToPayment ?? null) !== null;
  const hasTripData = (data?.avgDaysToTrip ?? null) !== null;
  const conversionPct = data
    ? data.totalClients > 0
      ? Math.round((data.clientsWithPayment / data.totalClients) * 1000) / 10
      : 0
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionHeader
          icon={Clock}
          title="Ciclo de Venda"
          description="Tempo médio do cadastro do cliente até o primeiro pagamento e embarque"
        />
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {(["30d", "90d", "12m"] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateCycleFilters({ period: p })}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  cyclePeriod === p ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-5 flex items-start gap-4">
            <div className="mt-1 p-2 rounded-md bg-muted text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">Ciclo médio até pagamento</p>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold mt-0.5">{fmtDays(data?.avgDaysToPayment)}</p>
              )}
              {!isLoading && data?.medianDaysToPayment != null && (
                <p className="text-xs text-muted-foreground mt-0.5">Mediana: {fmtDays(data.medianDaysToPayment)}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-start gap-4">
            <div className="mt-1 p-2 rounded-md bg-muted text-purple-600">
              <Map className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">Ciclo médio até embarque</p>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold mt-0.5">{fmtDays(data?.avgDaysToTrip)}</p>
              )}
              {!isLoading && data?.medianDaysToTrip != null && (
                <p className="text-xs text-muted-foreground mt-0.5">Mediana: {fmtDays(data.medianDaysToTrip)}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-start gap-4">
            <div className="mt-1 p-2 rounded-md bg-muted text-teal-600">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">Clientes analisados</p>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold mt-0.5">{data?.totalClients ?? 0}</p>
              )}
              {!isLoading && (
                <p className="text-xs text-muted-foreground mt-0.5">{SC_PERIOD_LABELS[cyclePeriod]}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-start gap-4">
            <div className="mt-1 p-2 rounded-md bg-muted text-green-600">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">Taxa de conversão</p>
              {isLoading ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold mt-0.5">{fmtPct(conversionPct)}</p>
              )}
              {!isLoading && data && (
                <p className="text-xs text-muted-foreground mt-0.5">{data.clientsWithPayment} de {data.totalClients} pagaram</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <AlertTriangle className="w-6 h-6" />
          <p className="text-sm">Não foi possível carregar os dados.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      )}

      {!isError && (
        <>
          {/* ── Channel selector + Trend chart ── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">Tendência Mensal — Últimos 12 meses</CardTitle>
                {(channelOptions.length > 0 || cycleChannel !== undefined) && (
                  <Select
                    value={cycleChannel ?? "__all__"}
                    onValueChange={(v) => updateCycleFilters({ channel: v === "__all__" ? undefined : v })}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue placeholder="Canal de aquisição" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os canais</SelectItem>
                      {channelOptions.map((ch) => (
                        <SelectItem key={ch} value={ch}>{ch}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(data?.bySeller?.length > 0 || cycleSeller !== undefined) && (
                  <Select
                    value={cycleSeller ?? "__all__"}
                    onValueChange={(v) => updateCycleFilters({ seller: v === "__all__" ? undefined : v })}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue placeholder="Vendedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todos os vendedores</SelectItem>
                      {(data?.bySeller ?? []).map((seller: { sellerId: string; sellerName: string }) => (
                        <SelectItem key={seller.sellerId} value={seller.sellerId}>{seller.sellerName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (!hasPaymentData && !hasTripData) ? (
                <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                  Dados insuficientes para calcular o ciclo de venda no período selecionado.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      tickFormatter={(v: number) => `${v.toFixed(0)}d`}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value.toFixed(1)} dias`, name]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="pagamento"
                      name="Até pagamento"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="viagem"
                      name="Até embarque"
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ── Breakdown by channel ── */}
          {!isLoading && data && data.byChannel.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Breakdown por Canal de Origem</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Canal</th>
                      <th className="py-2 px-3 font-medium text-right">Clientes</th>
                      <th className="py-2 px-3 font-medium text-right">Ciclo até pagamento</th>
                      <th className="py-2 px-3 font-medium text-right">Ciclo até embarque</th>
                      <th className="py-2 pl-3 font-medium text-right">Taxa de conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byChannel.map((ch: { origin: string; clients: number; avgDaysToPayment: number | null; avgDaysToTrip: number | null; conversionRate: number }) => (
                      <tr key={ch.origin} className="border-b last:border-0">
                        <td className="py-3 pr-3">
                          <span className="font-medium">{ch.origin}</span>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">{ch.clients}</td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {ch.avgDaysToPayment != null ? (
                            <span className="font-medium text-blue-600">{fmtDays(ch.avgDaysToPayment)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {ch.avgDaysToTrip != null ? (
                            <span className="font-medium text-purple-600">{fmtDays(ch.avgDaysToTrip)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 pl-3 text-right tabular-nums">
                          <span className={ch.conversionRate >= 50 ? "text-emerald-600 font-medium" : ch.conversionRate >= 25 ? "text-yellow-600 font-medium" : "text-red-600 font-medium"}>
                            {fmtPct(ch.conversionRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data.p25DaysToPayment != null && data.p75DaysToPayment != null && (
                  <div className="mt-4 flex gap-3 rounded-lg bg-muted/50 p-3">
                    <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Intervalo interquartil (P25–P75):</span>{" "}
                      {fmtDays(data.p25DaysToPayment)} — {fmtDays(data.p75DaysToPayment)} para o primeiro pagamento.{" "}
                      50% dos clientes pagam dentro desse intervalo.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Breakdown by seller ── */}
          {!isLoading && data && data.bySeller && data.bySeller.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Breakdown por Vendedor</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Vendedor</th>
                      <th className="py-2 px-3 font-medium text-right">Clientes</th>
                      <th className="py-2 px-3 font-medium text-right">Ciclo até pagamento</th>
                      <th className="py-2 pl-3 font-medium text-right">Taxa de conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySeller.map((s: { sellerId: string; sellerName: string; clients: number; avgDaysToPayment: number | null; conversionRate: number }, idx: number) => (
                      <tr key={s.sellerId} className="border-b last:border-0">
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2">
                            {idx === 0 && s.avgDaysToPayment != null && (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">1</span>
                            )}
                            <span className="font-medium">{s.sellerName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">{s.clients}</td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {s.avgDaysToPayment != null ? (
                            <span className={`font-medium ${idx === 0 ? "text-emerald-600" : "text-blue-600"}`}>{fmtDays(s.avgDaysToPayment)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 pl-3 text-right tabular-nums">
                          <span className={s.conversionRate >= 50 ? "text-emerald-600 font-medium" : s.conversionRate >= 25 ? "text-yellow-600 font-medium" : "text-red-600 font-medium"}>
                            {fmtPct(s.conversionRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  Ordenado pelo menor ciclo médio até o primeiro pagamento. Apenas vendedores com ≥ 3 clientes no período são exibidos.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ForecastTab() {
  const [horizon, setHorizon] = useState<"30" | "60" | "90">("90");
  const { data, isLoading, isError, refetch, isFetching } = useGetRevenueForecast();
  const occupancy = useGetOccupancyRisk();

  const months = HORIZON_TO_MONTHS[horizon] ?? 3;
  const history = (data?.history ?? []).slice(-12);
  const forecast = (data?.forecast ?? []).slice(0, months);

  const chartData = [
    ...history.map((h, i) => {
      const isLast = i === history.length - 1;
      return {
        month: fmtMonthLabel(h.month),
        historico: h.revenue,
        base: isLast ? h.revenue : null,
        otimista: isLast ? h.revenue : null,
        pessimista: isLast ? h.revenue : null,
      };
    }),
    ...forecast.map((f) => ({
      month: fmtMonthLabel(f.month),
      historico: null as number | null,
      base: f.base,
      otimista: f.optimistic,
      pessimista: f.pessimistic,
    })),
  ];

  const baseTotal = forecast.reduce((s, f) => s + f.base, 0);
  const optTotal = forecast.reduce((s, f) => s + f.optimistic, 0);
  const pessTotal = forecast.reduce((s, f) => s + f.pessimistic, 0);

  const occ = occupancy.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionHeader
          icon={Sparkles}
          title="Previsões com IA"
          description="Projeção de faturamento e risco de ocupação das próximas viagens"
        />
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {(["30", "60", "90"] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  horizon === h ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {h} dias
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Previsão de Faturamento
            {data?.source === "ai" && <Badge variant="secondary" className="text-xs font-normal">IA</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : isError ? (
            <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <AlertTriangle className="w-6 h-6" />
              <p className="text-sm">Não foi possível gerar a previsão.</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              Sem histórico de receita suficiente para projetar.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="historico" name="Histórico" stroke="var(--primary)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="otimista" name="Otimista" stroke="#10B981" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                <Line type="monotone" dataKey="base" name="Base" stroke="#3B82F6" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="pessimista" name="Pessimista" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}

          {!isLoading && !isError && forecast.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cenário pessimista</p>
                  <p className="text-lg font-bold text-red-600">{fmtCompact(pessTotal)}</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                  <p className="text-xs text-muted-foreground">Cenário base</p>
                  <p className="text-lg font-bold text-blue-600">{fmtCompact(baseTotal)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Cenário otimista</p>
                  <p className="text-lg font-bold text-emerald-600">{fmtCompact(optTotal)}</p>
                </div>
              </div>
              {data?.narrative && (
                <div className="mt-4 flex gap-3 rounded-lg bg-muted/50 p-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground leading-relaxed">{data.narrative}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Risco de Ocupação — Próximas Viagens
          </CardTitle>
        </CardHeader>
        <CardContent>
          {occupancy.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : occupancy.isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
              <AlertTriangle className="w-6 h-6" />
              <p className="text-sm">Não foi possível carregar o risco de ocupação.</p>
            </div>
          ) : !occ || occ.trips.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma viagem futura com reservas para analisar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <Badge variant="outline" className={RISK_CONFIG.red.badge}>{occ.counts.red} alto risco</Badge>
                <Badge variant="outline" className={RISK_CONFIG.yellow.badge}>{occ.counts.yellow} em atenção</Badge>
                <Badge variant="outline" className={RISK_CONFIG.green.badge}>{occ.counts.green} saudáveis</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Viagem</th>
                      <th className="py-2 px-3 font-medium">Embarque</th>
                      <th className="py-2 px-3 font-medium">Ocupação</th>
                      <th className="py-2 px-3 font-medium">Risco</th>
                      <th className="py-2 pl-3 font-medium">Análise IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {occ.trips.map((t) => {
                      const rc = RISK_CONFIG[t.risk] ?? RISK_CONFIG.green;
                      return (
                        <tr key={t.id} className="border-b last:border-0 align-top">
                          <td className="py-3 pr-3">
                            <p className="font-medium">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.destination}</p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <p>{fmtDateBR(t.departureDate)}</p>
                            <p className="text-xs text-muted-foreground">em {t.daysUntil} dias</p>
                          </td>
                          <td className="py-3 px-3 min-w-[140px]">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium">{t.occupied}/{t.capacity}</span>
                              <span className="text-muted-foreground">{t.fillRate.toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div className={`h-2 rounded-full ${rc.dot}`} style={{ width: `${Math.min(t.fillRate, 100)}%` }} />
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${rc.badge}`}>
                              <span className={`w-2 h-2 rounded-full ${rc.dot}`} />
                              {rc.label}
                            </span>
                          </td>
                          <td className="py-3 pl-3 text-xs text-muted-foreground max-w-[260px]">
                            {t.comment ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {occ.summary && (
                <div className="mt-4 flex gap-3 rounded-lg bg-muted/50 p-3">
                  <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground leading-relaxed">{occ.summary}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SimuladorTab() {
  const [leads, setLeads] = useState(0);
  const [price, setPrice] = useState(0);
  const [conversion, setConversion] = useState(0);
  const simulator = useRunSimulator();
  const result = simulator.data;

  function runSimulation() {
    simulator.mutate({ leadsChangePct: leads, priceChangePct: price, conversionChangePct: conversion });
  }

  function reset() {
    setLeads(0);
    setPrice(0);
    setConversion(0);
    simulator.reset();
  }

  const sliders = [
    { label: "Volume de Leads", value: leads, set: setLeads, min: -50, max: 100, color: "text-blue-600" },
    { label: "Preço / Ticket Médio", value: price, set: setPrice, min: -30, max: 30, color: "text-purple-600" },
    { label: "Taxa de Conversão", value: conversion, set: setConversion, min: -50, max: 100, color: "text-teal-600" },
  ];

  const positive = (result?.deltaRevenue ?? 0) >= 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={SlidersHorizontal}
        title="Simulador de Receita"
        description="Ajuste as alavancas comerciais e veja o impacto projetado no faturamento"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Variáveis da Simulação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            {sliders.map((s) => (
              <div key={s.label}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <span className={`text-sm font-semibold ${s.color}`}>{s.value > 0 ? "+" : ""}{s.value}%</span>
                </div>
                <Slider
                  value={[s.value]}
                  min={s.min}
                  max={s.max}
                  step={5}
                  onValueChange={(v) => s.set(v[0] ?? 0)}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{s.min}%</span>
                  <span>{s.max > 0 ? "+" : ""}{s.max}%</span>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button onClick={runSimulation} disabled={simulator.isPending} className="flex-1 gap-1.5">
                {simulator.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                Simular impacto
              </Button>
              <Button variant="outline" onClick={reset} disabled={simulator.isPending}>Limpar</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Impacto Projetado
              {result?.source === "ai" && <Badge variant="secondary" className="text-xs font-normal">IA</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {simulator.isPending ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin" />
                <p className="text-sm">Calculando projeção...</p>
              </div>
            ) : simulator.isError ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <AlertTriangle className="w-6 h-6" />
                <p className="text-sm">Não foi possível simular. Tente novamente.</p>
              </div>
            ) : !result ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <SlidersHorizontal className="w-7 h-7" />
                <p className="text-sm">Ajuste as variáveis e clique em <span className="font-medium">Simular impacto</span>.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Receita base (mês)</span>
                  <span className="font-semibold">{fmt(result.baselineRevenue)}</span>
                </div>
                <div className="rounded-lg border p-4 text-center">
                  <p className="text-xs text-muted-foreground">Receita projetada</p>
                  <p className="text-3xl font-bold mt-1">{fmt(result.projectedRevenue)}</p>
                  <p className={`text-sm font-medium mt-1 ${positive ? "text-emerald-600" : "text-red-600"}`}>
                    {positive ? "+" : ""}{fmt(result.deltaRevenue)} ({positive ? "+" : ""}{result.deltaPct.toFixed(1)}%)
                  </p>
                </div>
                {result.reasoning && (
                  <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
                    <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{result.reasoning}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Insights() {
  const [period, setPeriod] = useState<GetInsightsSummaryPeriod>("month");
  const [chatOpen, setChatOpen] = useState(false);
  const { data, isLoading } = useGetInsightsSummary({ period });
  const prevLabel = PERIOD_LABELS[period] ?? "período anterior";

  const ex = data?.executive;
  const co = data?.commercial;
  const mk = data?.marketing;
  const fi = data?.financial;
  const op = data?.operational;
  const re = data?.retention;
  const ex2 = data?.expansion;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-primary" />
            Insights Estratégicos
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Inteligência de negócio em 7 pilares — variações vs. {prevLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as GetInsightsSummaryPeriod)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Este mês</SelectItem>
              <SelectItem value="quarter">Último trimestre</SelectItem>
              <SelectItem value="year">Este ano</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={chatOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setChatOpen((v) => !v)}
            className="gap-1.5"
          >
            {chatOpen ? <X className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
            {chatOpen ? "Fechar IA" : "Perguntar à IA"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="executiva">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="executiva">Executiva</TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="marketing">Marketing</TabsTrigger>
          <TabsTrigger value="financeira">Financeira</TabsTrigger>
          <TabsTrigger value="operacional">Operacional</TabsTrigger>
          <TabsTrigger value="retencao">Retenção</TabsTrigger>
          <TabsTrigger value="expansao">Expansão</TabsTrigger>
          <TabsTrigger value="ciclo" className="gap-1"><Clock className="w-3.5 h-3.5" />Ciclo de Venda</TabsTrigger>
          <TabsTrigger value="previsoes" className="gap-1"><Sparkles className="w-3.5 h-3.5" />Previsões</TabsTrigger>
          <TabsTrigger value="simulador" className="gap-1"><SlidersHorizontal className="w-3.5 h-3.5" />Simulador</TabsTrigger>
          <TabsTrigger value="assistente" className="gap-1"><Bot className="w-3.5 h-3.5" />Assistente</TabsTrigger>
        </TabsList>

        {/* ─── EXECUTIVA ─────────────────────────────────────────────── */}
        <TabsContent value="executiva" className="mt-5 space-y-4">
          <SectionHeader
            icon={BarChart2}
            title="Visão Executiva"
            description="Panorama completo da saúde do negócio no período"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={DollarSign} label="Receita Total" value={ex?.totalRevenue ?? 0} prev={ex?.totalRevenuePrev ?? null} format="compact" color="text-green-600" loading={isLoading} prevValue={fmtCompact(ex?.totalRevenuePrev ?? 0)} />
            <KpiCard icon={TrendingUp} label="Lucro Líquido" value={ex?.netProfit ?? 0} prev={ex?.netProfitPrev ?? null} format="compact" color={(ex?.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"} loading={isLoading} prevValue={fmtCompact(ex?.netProfitPrev ?? 0)} />
            <KpiCard icon={Target} label="Margem de Lucro" value={ex?.profitMargin ?? 0} prev={ex?.profitMarginPrev ?? null} format="pct" color="text-indigo-600" loading={isLoading} prevValue={fmtPct(ex?.profitMarginPrev ?? 0)} />
            <KpiCard icon={Users} label="Novos Clientes" value={ex?.newClients ?? 0} prev={ex?.newClientsPrev ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(ex?.newClientsPrev ?? 0)} />
            <KpiCard icon={ShoppingCart} label="Reservas Confirmadas" value={ex?.confirmedReservations ?? 0} prev={ex?.confirmedReservationsPrev ?? null} format="num" color="text-blue-600" loading={isLoading} prevValue={fmtNum(ex?.confirmedReservationsPrev ?? 0)} />
            <KpiCard icon={Map} label="Viagens Ativas" value={ex?.activeTrips ?? 0} format="num" color="text-orange-600" loading={isLoading} />
            <KpiCard icon={Zap} label="Taxa de Conversão" value={ex?.conversionRate ?? 0} prev={ex?.conversionRatePrev ?? null} format="pct" color="text-purple-600" loading={isLoading} prevValue={fmtPct(ex?.conversionRatePrev ?? 0)} />
            <KpiCard icon={BarChart2} label="Ocupação Média" value={ex?.occupancyRate ?? 0} format="pct" color="text-cyan-600" loading={isLoading} />
          </div>

          {!isLoading && ex && (ex.momGrowth != null || ex.yoyGrowth != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Crescimento de Receita</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-8">
                {ex.momGrowth != null && (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">MoM (mês vs. anterior)</span>
                    <div className="flex items-center gap-2">
                      <GrowthBadge value={ex.momGrowth} />
                    </div>
                  </div>
                )}
                {ex.yoyGrowth != null && (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">YoY (ano vs. anterior)</span>
                    <div className="flex items-center gap-2">
                      <GrowthBadge value={ex.yoyGrowth} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <NpsCard averageNps={ex?.averageNps} averageNpsPrev={ex?.averageNpsPrev} />
        </TabsContent>

        {/* ─── COMERCIAL ─────────────────────────────────────────────── */}
        <TabsContent value="comercial" className="mt-5 space-y-4">
          <SectionHeader
            icon={Target}
            title="Visão Comercial"
            description="Pipeline, conversão e desempenho de vendas"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={Target} label="Negócios Abertos" value={co?.openDeals ?? 0} prev={co?.openDealsPrev ?? null} format="num" color="text-orange-600" loading={isLoading} prevValue={fmtNum(co?.openDealsPrev ?? 0)} />
            <KpiCard icon={TrendingUp} label="Negócios Ganhos" value={co?.wonDeals ?? 0} prev={co?.wonDealsPrev ?? null} format="num" color="text-green-600" loading={isLoading} prevValue={fmtNum(co?.wonDealsPrev ?? 0)} />
            <KpiCard icon={DollarSign} label="Valor do Pipeline" value={co?.pipelineValue ?? 0} prev={co?.pipelineValuePrev ?? null} format="compact" color="text-blue-600" loading={isLoading} prevValue={fmtCompact(co?.pipelineValuePrev ?? 0)} />
            <KpiCard icon={DollarSign} label="Ticket Médio" value={co?.avgTicket ?? 0} prev={co?.avgTicketPrev ?? null} format="compact" color="text-purple-600" loading={isLoading} prevValue={fmtCompact(co?.avgTicketPrev ?? 0)} />
            <KpiCard icon={ShoppingCart} label="Novas Reservas" value={co?.newReservations ?? 0} prev={co?.newReservationsPrev ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(co?.newReservationsPrev ?? 0)} />
            <KpiCard icon={Zap} label="Taxa de Conversão" value={co?.conversionRate ?? 0} prev={co?.conversionRatePrev ?? null} format="pct" color="text-indigo-600" loading={isLoading} prevValue={fmtPct(co?.conversionRatePrev ?? 0)} />
            <KpiCard icon={Repeat2} label="Clientes Recorrentes" value={co?.repeatClients ?? 0} prev={co?.repeatClientsPrev ?? null} format="num" color="text-cyan-600" loading={isLoading} prevValue={fmtNum(co?.repeatClientsPrev ?? 0)} sub="compraram ≥2x" />
            <KpiCard icon={TrendingDown} label="Cancelamentos" value={co?.cancellations ?? 0} prev={co?.cancellationsPrev ?? null} format="num" color="text-red-600" loading={isLoading} invert prevValue={fmtNum(co?.cancellationsPrev ?? 0)} />
            <KpiCard icon={UserCheck} label="Clientes Ativos" value={co?.activeClients ?? 0} prev={co?.activeClientsPrev ?? null} format="num" color="text-emerald-600" loading={isLoading} prevValue={fmtNum(co?.activeClientsPrev ?? 0)} sub="com ≥1 reserva confirmada" />
            <KpiCard icon={TrendingUp} label="LTV Estimado" value={co?.ltv ?? 0} prev={co?.ltvPrev ?? null} format="compact" color="text-purple-600" loading={isLoading} prevValue={fmtCompact(co?.ltvPrev ?? 0)} sub="ticket × freq. de compras" />
            <KpiCard icon={DollarSign} label="CAC Estimado" value={co?.cac ?? 0} prev={co?.cacPrev ?? null} format="compact" color="text-orange-500" loading={isLoading} invert prevValue={fmtCompact(co?.cacPrev ?? 0)} sub="comissões / novos clientes" />
          </div>

          {!isLoading && co && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Funil de Conversão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Leads Totais", value: co.totalLeads, color: "#3B82F6" },
                  { label: "Negócios Abertos", value: co.openDeals, color: "#8B5CF6" },
                  { label: "Novas Reservas", value: co.newReservations, color: "#F59E0B" },
                  { label: "Confirmadas", value: co.wonDeals, color: "#10B981" },
                ].map((item) => {
                  const max = co.totalLeads || 1;
                  return (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-32 shrink-0">{item.label}</span>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div className="h-5 rounded-full flex items-center justify-end pr-2" style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, backgroundColor: item.color }}>
                          <span className="text-xs font-medium text-white">{item.value}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── MARKETING ─────────────────────────────────────────────── */}
        <TabsContent value="marketing" className="mt-5 space-y-4">
          <SectionHeader
            icon={Zap}
            title="Visão de Marketing"
            description="Campanhas, captação de clientes e conversão"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={Users} label="Novos Clientes" value={mk?.newClients ?? 0} prev={mk?.newClientsPrev ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(mk?.newClientsPrev ?? 0)} />
            <KpiCard icon={Target} label="Total de Leads" value={mk?.totalLeads ?? 0} prev={mk?.totalLeadsPrev ?? null} format="num" color="text-blue-600" loading={isLoading} prevValue={fmtNum(mk?.totalLeadsPrev ?? 0)} />
            <KpiCard icon={Zap} label="Taxa de Conversão" value={mk?.conversionRate ?? 0} prev={mk?.conversionRatePrev ?? null} format="pct" color="text-indigo-600" loading={isLoading} prevValue={fmtPct(mk?.conversionRatePrev ?? 0)} />
            <KpiCard icon={ArrowUpRight} label="Indicações Geradas" value={mk?.referrals ?? 0} prev={mk?.referralsPrev ?? null} format="num" color="text-orange-600" loading={isLoading} prevValue={fmtNum(mk?.referralsPrev ?? 0)} />
            <KpiCard icon={CheckCircle2} label="Indicações Convertidas" value={mk?.convertedReferrals ?? 0} prev={mk?.convertedReferralsPrev ?? null} format="num" color="text-green-600" loading={isLoading} prevValue={fmtNum(mk?.convertedReferralsPrev ?? 0)} />
            <KpiCard icon={Send} label="Campanhas Ativas" value={mk?.activeCampaigns ?? 0} format="num" color="text-purple-600" loading={isLoading} sub={`${mk?.newCampaigns ?? 0} criadas no período`} />
            <KpiCard icon={Mail} label="E-mails Enviados" value={mk?.totalSentMessages ?? 0} format="num" color="text-cyan-600" loading={isLoading} sub={`${mk?.sentCampaigns ?? 0} campanhas disparadas`} />
            <KpiCard icon={MousePointerClick} label="Taxa de Abertura" value={mk?.openRate ?? 0} format="pct" color="text-yellow-600" loading={isLoading} sub={`Click rate: ${fmtPct(mk?.clickRate ?? 0)}`} />
            <KpiCard icon={TrendingUp} label="ROI por Campanha" value={mk?.campaignRoi ?? 0} format="compact" color="text-green-600" loading={isLoading} sub="receita / campanhas enviadas" />
          </div>

          {!isLoading && mk && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Performance de Campanhas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Campanhas ativas</span>
                    <span className="font-semibold">{mk.activeCampaigns}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Disparadas no período</span>
                    <span className="font-semibold">{mk.sentCampaigns}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Total de destinatários</span>
                    <span className="font-semibold">{mk.totalRecipients.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Abertos</span>
                    <span className="font-semibold text-primary">{mk.totalOpenedMessages.toLocaleString("pt-BR")} ({fmtPct(mk.openRate)})</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Clicados</span>
                    <span className="font-semibold text-indigo-600">{mk.totalClickedMessages.toLocaleString("pt-BR")} ({fmtPct(mk.clickRate)})</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Captação & Indicações</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Novos clientes</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{mk.newClients}</span>
                      <GrowthBadge value={pctChange(mk.newClients, mk.newClientsPrev)} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Indicações geradas</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{mk.referrals}</span>
                      <GrowthBadge value={pctChange(mk.referrals, mk.referralsPrev)} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Indicações convertidas</span>
                    <span className="font-semibold text-green-600">{mk.convertedReferrals}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Conversão leads → venda</span>
                    <span className="font-semibold text-primary">{fmtPct(mk.conversionRate)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── FINANCEIRA ────────────────────────────────────────────── */}
        <TabsContent value="financeira" className="mt-5 space-y-4">
          <SectionHeader
            icon={DollarSign}
            title="Visão Financeira"
            description="Receita, despesas, margem, comissões e fluxo de caixa"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={DollarSign} label="Receita Total" value={fi?.totalRevenue ?? 0} prev={fi?.totalRevenuePrev ?? null} format="compact" color="text-green-600" loading={isLoading} prevValue={fmtCompact(fi?.totalRevenuePrev ?? 0)} />
            <KpiCard icon={TrendingDown} label="Despesas Totais" value={fi?.totalExpenses ?? 0} prev={fi?.totalExpensesPrev ?? null} format="compact" color="text-red-600" loading={isLoading} invert prevValue={fmtCompact(fi?.totalExpensesPrev ?? 0)} />
            <KpiCard icon={TrendingUp} label="Lucro Líquido" value={fi?.netProfit ?? 0} prev={fi?.netProfitPrev ?? null} format="compact" color={(fi?.netProfit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"} loading={isLoading} prevValue={fmtCompact(fi?.netProfitPrev ?? 0)} />
            <KpiCard icon={Target} label="Margem de Lucro" value={fi?.profitMargin ?? 0} prev={fi?.profitMarginPrev ?? null} format="pct" color="text-indigo-600" loading={isLoading} prevValue={fmtPct(fi?.profitMarginPrev ?? 0)} />
            <KpiCard icon={Award} label="Comissões Pagas" value={fi?.commissions ?? 0} prev={fi?.commissionsPrev ?? null} format="compact" color="text-yellow-600" loading={isLoading} prevValue={fmtCompact(fi?.commissionsPrev ?? 0)} />
            <KpiCard icon={DollarSign} label="Ticket Médio" value={fi?.avgTicket ?? 0} prev={fi?.avgTicketPrev ?? null} format="compact" color="text-purple-600" loading={isLoading} prevValue={fmtCompact(fi?.avgTicketPrev ?? 0)} />
            <KpiCard icon={ArrowUpRight} label="A Receber" value={fi?.receivable ?? 0} format="compact" color="text-blue-600" loading={isLoading} />
            <KpiCard icon={ArrowDownRight} label="A Pagar" value={fi?.payable ?? 0} format="compact" color="text-orange-600" loading={isLoading} />
          </div>

          {!isLoading && fi && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">DRE — Demonstrativo de Resultado</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Receita Bruta</span>
                    <span className="font-semibold text-green-600">{fmt(fi.totalRevenue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">(-) Despesas</span>
                    <span className="font-semibold text-red-600">- {fmt(fi.totalExpenses)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">(-) Comissões</span>
                    <span className="font-semibold text-yellow-700">- {fmt(fi.commissions)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm font-medium">Lucro Líquido</span>
                    <span className={`font-bold text-base ${fi.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fi.netProfit >= 0 ? "+" : ""}{fmt(fi.netProfit)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Margem de Lucro</span>
                    <span className={`font-semibold ${fi.profitMargin >= 20 ? "text-emerald-600" : fi.profitMargin >= 10 ? "text-yellow-600" : "text-red-600"}`}>
                      {fmtPct(fi.profitMargin)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Inadimplência (vencido)</span>
                    <span className="font-semibold text-red-500">{fmt(fi.overdue)}</span>
                  </div>
                </CardContent>
              </Card>

              {fi.expenseCategories.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Despesas por Categoria</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {fi.expenseCategories.slice(0, 6).map((cat) => {
                      const max = fi.expenseCategories[0]?.total ?? 1;
                      return (
                        <div key={cat.category} className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground w-28 truncate shrink-0 capitalize">{cat.category}</span>
                          <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                            <div className="bg-red-400 h-4 rounded-full flex items-center justify-end pr-1" style={{ width: `${Math.max((cat.total / max) * 100, 4)}%` }}>
                              <span className="text-[10px] font-medium text-white"></span>
                            </div>
                          </div>
                          <span className="text-xs font-semibold w-20 text-right shrink-0">{fmtCompact(cat.total)}</span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── OPERACIONAL ───────────────────────────────────────────── */}
        <TabsContent value="operacional" className="mt-5 space-y-4">
          <SectionHeader
            icon={Map}
            title="Visão Operacional"
            description="Viagens, embarques, passageiros, ocupação e satisfação"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={Map} label="Viagens Ativas" value={op?.activeTrips ?? 0} format="num" color="text-blue-600" loading={isLoading} />
            <KpiCard icon={Map} label="Novas Viagens" value={op?.newTrips ?? 0} prev={op?.newTripsPrev ?? null} format="num" color="text-indigo-600" loading={isLoading} prevValue={fmtNum(op?.newTripsPrev ?? 0)} />
            <KpiCard icon={BarChart2} label="Taxa de Ocupação" value={op?.occupancyRate ?? 0} format="pct" color="text-cyan-600" loading={isLoading} />
            <KpiCard icon={Navigation} label="Vagas Disponíveis" value={op?.totalAvailableSeats ?? 0} format="num" color="text-orange-500" loading={isLoading} sub="em viagens ativas" />
            <KpiCard icon={ShoppingCart} label="Reservas Confirmadas" value={op?.confirmedReservations ?? 0} prev={op?.confirmedReservationsPrev ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(op?.confirmedReservationsPrev ?? 0)} />
            <KpiCard icon={UserCheck} label="Check-in Realizados" value={op?.checkedInPassengers ?? 0} prev={op?.checkedInPassengersPrev ?? null} format="num" color="text-green-600" loading={isLoading} prevValue={fmtNum(op?.checkedInPassengersPrev ?? 0)} sub="passageiros embarcados" />
            <KpiCard icon={TrendingDown} label="Cancelamentos" value={op?.cancellations ?? 0} prev={op?.cancellationsPrev ?? null} format="num" color="text-red-600" loading={isLoading} invert prevValue={fmtNum(op?.cancellationsPrev ?? 0)} />
            <KpiCard icon={Package} label="Fornecedores" value={op?.totalSuppliers ?? 0} format="num" color="text-purple-600" loading={isLoading} sub={`+${op?.newSuppliers ?? 0} este período`} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {!isLoading && op && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Eficiência Operacional</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Reservas por viagem</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{op.avgReservationsPerTrip.toFixed(1)}</span>
                      <GrowthBadge value={pctChange(op.avgReservationsPerTrip, op.avgReservationsPerTripPrev)} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Receita por viagem</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{fmtCompact(op.revenuePerTrip)}</span>
                      <GrowthBadge value={pctChange(op.revenuePerTrip, op.revenuePerTripPrev)} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Vagas disponíveis</span>
                    <span className="font-semibold">{op.totalAvailableSeats}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Check-ins realizados</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-green-600">{op.checkedInPassengers}</span>
                      <GrowthBadge value={pctChange(op.checkedInPassengers, op.checkedInPassengersPrev)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <NpsCard averageNps={op?.averageNps} averageNpsPrev={op?.averageNpsPrev} />
          </div>
        </TabsContent>

        {/* ─── RETENÇÃO ──────────────────────────────────────────────── */}
        <TabsContent value="retencao" className="mt-5 space-y-4">
          <SectionHeader
            icon={Heart}
            title="Retenção & Comunidade"
            description="Fidelidade, NPS, indicações e engajamento da base de clientes"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={Repeat2} label="Clientes Recorrentes" value={re?.repeatClients ?? 0} prev={re?.repeatClientsPrev ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(re?.repeatClientsPrev ?? 0)} sub="compraram ≥2x" />
            <KpiCard icon={Target} label="Taxa de Retenção" value={re?.retentionRate ?? 0} prev={re?.retentionRatePrev ?? null} format="pct" color="text-indigo-600" loading={isLoading} prevValue={fmtPct(re?.retentionRatePrev ?? 0)} />
            <KpiCard icon={ArrowUpRight} label="Taxa de Indicação" value={re?.referralRate ?? 0} prev={re?.referralRatePrev ?? null} format="pct" color="text-orange-600" loading={isLoading} prevValue={fmtPct(re?.referralRatePrev ?? 0)} />
            <KpiCard icon={Star} label="Membros Fidelidade" value={re?.loyaltyMembers ?? 0} format="num" color="text-yellow-600" loading={isLoading} sub={`${re?.loyaltyActiveMembers ?? 0} ativos`} />
            <KpiCard icon={Award} label="Clientes Promotores" value={re?.promoterClients ?? 0} prev={re?.promoterClientsPrev ?? null} format="num" color="text-green-600" loading={isLoading} prevValue={fmtNum(re?.promoterClientsPrev ?? 0)} sub="NPS ≥ 9" />
            <KpiCard icon={CheckCircle2} label="Indicações Convertidas" value={re?.convertedReferrals ?? 0} prev={re?.convertedReferralsPrev ?? null} format="num" color="text-cyan-600" loading={isLoading} prevValue={fmtNum(re?.convertedReferralsPrev ?? 0)} />
            <KpiCard icon={Users} label="Novos Clientes" value={re?.newClients ?? 0} prev={re?.newClientsPrev ?? null} format="num" color="text-blue-600" loading={isLoading} prevValue={fmtNum(re?.newClientsPrev ?? 0)} />
            <KpiCard icon={Users} label="Total de Clientes" value={re?.totalClients ?? 0} format="num" color="text-gray-600" loading={isLoading} />
          </div>

          <NpsCard averageNps={re?.averageNps} averageNpsPrev={re?.averageNpsPrev} />

          {!isLoading && re && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Base de Clientes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Total de clientes</span>
                    <span className="font-semibold">{re.totalClients}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Novos no período</span>
                    <span className="font-semibold text-green-600">+{re.newClients}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Recorrentes (≥2 compras)</span>
                    <span className="font-semibold text-blue-600">{re.repeatClients}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Taxa de retenção</span>
                    <span className="font-semibold text-indigo-600">{fmtPct(re.retentionRate)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Taxa de indicação</span>
                    <span className="font-semibold text-orange-600">{fmtPct(re.referralRate)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Programa de Fidelidade & Promotores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Total de membros</span>
                    <span className="font-semibold">{re.loyaltyMembers}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Membros ativos (último ano)</span>
                    <span className="font-semibold text-yellow-600">{re.loyaltyActiveMembers}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Novos membros (período)</span>
                    <span className="font-semibold text-green-600">+{re.loyaltyNewMembers}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Clientes promotores (NPS ≥ 9)</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-green-600">{re.promoterClients}</span>
                      <GrowthBadge value={pctChange(re.promoterClients, re.promoterClientsPrev)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── EXPANSÃO ──────────────────────────────────────────────── */}
        <TabsContent value="expansao" className="mt-5 space-y-4">
          <SectionHeader
            icon={Globe}
            title="Expansão & Inovação"
            description="Crescimento de portfólio, novos destinos, parceiros e receita"
          />
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <KpiCard icon={Map} label="Novas Viagens" value={ex2?.newTrips ?? 0} prev={ex2?.newTripsPrev ?? null} format="num" color="text-blue-600" loading={isLoading} prevValue={fmtNum(ex2?.newTripsPrev ?? 0)} />
            <KpiCard icon={Globe} label="Novos Destinos (90d)" value={ex2?.newDestinations90d ?? 0} prev={ex2?.newDestinationsPrev90d ?? null} format="num" color="text-teal-600" loading={isLoading} prevValue={fmtNum(ex2?.newDestinationsPrev90d ?? 0)} sub={`${ex2?.totalDestinations ?? 0} destinos cadastrados`} />
            <KpiCard icon={Package} label="Novos Fornecedores" value={ex2?.newSuppliers ?? 0} prev={ex2?.newSuppliersPrev ?? null} format="num" color="text-indigo-600" loading={isLoading} prevValue={fmtNum(ex2?.newSuppliersPrev ?? 0)} sub={`${ex2?.totalSuppliers ?? 0} total`} />
            <KpiCard icon={DollarSign} label="Receita / Viagem" value={ex2?.revenuePerTrip ?? 0} prev={ex2?.revenuePerTripPrev ?? null} format="compact" color="text-green-600" loading={isLoading} prevValue={fmtCompact(ex2?.revenuePerTripPrev ?? 0)} />
            <KpiCard icon={DollarSign} label="Ticket Médio" value={ex2?.avgTicket ?? 0} prev={ex2?.avgTicketPrev ?? null} format="compact" color="text-purple-600" loading={isLoading} prevValue={fmtCompact(ex2?.avgTicketPrev ?? 0)} />
            <KpiCard icon={DollarSign} label="Receita Total" value={ex2?.totalRevenue ?? 0} prev={ex2?.totalRevenuePrev ?? null} format="compact" color="text-emerald-600" loading={isLoading} prevValue={fmtCompact(ex2?.totalRevenuePrev ?? 0)} />
            {!isLoading && ex2?.momGrowth != null && (
              <KpiCard icon={TrendingUp} label="Crescimento MoM" value={ex2.momGrowth} format="pct" color={ex2.momGrowth >= 0 ? "text-green-600" : "text-red-600"} loading={isLoading} sub="mês vs. mês anterior" />
            )}
            {!isLoading && ex2?.yoyGrowth != null && (
              <KpiCard icon={TrendingUp} label="Crescimento YoY" value={ex2.yoyGrowth} format="pct" color={ex2.yoyGrowth >= 0 ? "text-green-600" : "text-red-600"} loading={isLoading} sub="ano vs. ano anterior" />
            )}
          </div>

          {!isLoading && ex2 && (
            <div className="grid gap-4 md:grid-cols-2">
              {ex2.topDestinations.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="w-4 h-4" /> Top Destinos no Período
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {ex2.topDestinations.map((d, i) => {
                      const max = ex2.topDestinations[0]?.count ?? 1;
                      return (
                        <div key={d.name} className="flex items-center gap-3">
                          <span className="text-xs font-medium text-muted-foreground w-5 shrink-0">{i + 1}</span>
                          <span className="text-sm text-muted-foreground w-32 truncate shrink-0">{d.name}</span>
                          <div className="flex-1 bg-muted rounded-full h-2">
                            <div className="bg-primary h-2 rounded-full" style={{ width: `${(d.count / max) * 100}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-8 text-right">{d.count}</span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Crescimento de Receita</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Receita Total</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{fmtCompact(ex2.totalRevenue)}</span>
                      <GrowthBadge value={pctChange(ex2.totalRevenue, ex2.totalRevenuePrev)} />
                    </div>
                  </div>
                  {ex2.momGrowth != null && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-muted-foreground">Crescimento MoM</span>
                      <GrowthBadge value={ex2.momGrowth} />
                    </div>
                  )}
                  {ex2.yoyGrowth != null && (
                    <div className="flex justify-between items-center py-2 border-b">
                      <span className="text-sm text-muted-foreground">Crescimento YoY</span>
                      <GrowthBadge value={ex2.yoyGrowth} />
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Total de Fornecedores</span>
                    <span className="font-semibold">{ex2.totalSuppliers}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-muted-foreground">Destinos cadastrados</span>
                    <span className="font-semibold">{ex2.totalDestinations}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-muted-foreground">Novos destinos (90d)</span>
                    <span className="font-semibold text-teal-600">+{ex2.newDestinations90d}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── CICLO DE VENDA ────────────────────────────────────────── */}
        <TabsContent value="ciclo" className="mt-5">
          <SalesCycleTab />
        </TabsContent>

        {/* ─── PREVISÕES ─────────────────────────────────────────────── */}
        <TabsContent value="previsoes" className="mt-5">
          <ForecastTab />
        </TabsContent>

        {/* ─── SIMULADOR ─────────────────────────────────────────────── */}
        <TabsContent value="simulador" className="mt-5">
          <SimuladorTab />
        </TabsContent>

        {/* ─── ASSISTENTE ────────────────────────────────────────────── */}
        <TabsContent value="assistente" className="mt-5 space-y-4">
          <SectionHeader
            icon={Bot}
            title="Assistente Executivo"
            description="Converse com seu CFO/COO virtual sobre estratégia, finanças e operação"
          />
          <Card className="border-primary/20">
            <CardContent className="p-0">
              <StreamingChat
                endpoint="/api/insights/ask"
                emptyIcon={Bot}
                emptyTitle="Assistente Executivo (CFO/COO)"
                emptySubtitle="Faça perguntas estratégicas com base no panorama dos últimos 90 dias"
                suggestions={EXECUTIVE_QUESTIONS}
                placeholder="Pergunte ao seu CFO/COO virtual..."
                heightClass="h-[600px]"
                enableReport
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {chatOpen && (
        <Card className="border-primary/20 shadow-lg">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              Assistente de Inteligência Turística
              <Badge variant="secondary" className="text-xs font-normal">IA</Badge>
            </CardTitle>
            <button
              onClick={() => setChatOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </CardHeader>
          <CardContent className="p-0 pb-0">
            <StreamingChat
              endpoint="/api/insights/chat"
              extraBody={{ period }}
              emptyIcon={Bot}
              emptyTitle="Assistente de Inteligência Turística"
              emptySubtitle="Faça perguntas sobre os dados da agência no período selecionado"
              suggestions={SUGGESTED_QUESTIONS}
              placeholder="Pergunte algo sobre os dados da agência..."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
