import { useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  filterClientConversationSummaries,
  type ClientConversationSummary,
} from "@/lib/communicationTimeline";

interface ClientConversationListProps {
  summaries: ClientConversationSummary[];
  selectedClientId: string | null;
  onSelect: (clientId: string) => void;
  channelLabels: Record<string, string>;
  channelColors: Record<string, string>;
}

function formatConversationDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function ClientConversationList({
  summaries,
  selectedClientId,
  onSelect,
  channelLabels,
  channelColors,
}: ClientConversationListProps) {
  const [query, setQuery] = useState("");
  const filteredSummaries = useMemo(
    () => filterClientConversationSummaries(summaries, query),
    [summaries, query],
  );

  return (
    <section
      aria-label="Lista de conversas por cliente"
      className="flex max-h-[38dvh] min-h-[210px] flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm md:max-h-none md:min-h-0"
    >
      <div className="space-y-3 border-b border-border/70 bg-secondary/45 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Caixa de entrada</p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-foreground">Conversas</h2>
          </div>
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums text-foreground ring-1 ring-border/70">
            {summaries.length}
          </span>
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Buscar conversas por cliente ou mensagem"
            className="h-10 border-border/80 bg-card pl-9 shadow-none focus-visible:ring-2"
            data-testid="input-client-conversation-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente ou mensagem"
            value={query}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
        {filteredSummaries.length === 0 ? (
          <div
            className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground"
            data-testid="text-no-conversation-search-results"
            role="status"
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-primary">
              <MessageSquare aria-hidden="true" className="h-5 w-5" />
            </span>
            <span className="font-medium text-foreground">Nenhuma conversa encontrada</span>
            <span className="mt-1 text-xs">Tente outro nome ou trecho da mensagem.</span>
          </div>
        ) : (
          filteredSummaries.map((summary) => {
            const isSelected = selectedClientId === summary.clientId;
            const initials = summary.clientName
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0] ?? "")
              .join("")
              .toLocaleUpperCase("pt-BR");
            return (
              <button
                aria-pressed={isSelected}
                className={`group relative w-full p-3.5 text-left transition-colors hover:bg-secondary/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  isSelected ? "bg-primary/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : ""
                }`}
                data-testid={`button-conversation-${summary.clientId}`}
                key={summary.clientId}
                onClick={() => onSelect(summary.clientId)}
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold tracking-wide ${
                    isSelected ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
                  }`} aria-hidden="true">
                    {initials || <MessageSquare className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground" data-testid={`text-conversation-client-${summary.clientId}`}>
                        {summary.clientName}
                      </p>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatConversationDate(summary.lastMessage.sentAt)}
                  </span>
                    </div>
                    <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
                      <span className="font-medium text-foreground/75">{summary.lastMessage.actor === "client"
                        ? "Cliente"
                        : summary.lastMessage.actor === "ai"
                          ? "Atendimento IA"
                          : "Equipe"}</span>
                      <span aria-hidden="true"> · </span>
                      {summary.lastMessage.content || (summary.lastMessage.mediaUrl ? "Mídia anexada" : "Mensagem sem texto")}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge
                        className={`h-5 rounded-md px-1.5 text-[10px] font-medium ${channelColors[summary.lastMessage.channel] ?? ""}`}
                        variant="secondary"
                      >
                        {channelLabels[summary.lastMessage.channel] ?? summary.lastMessage.channel}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{summary.count} mensagens</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}