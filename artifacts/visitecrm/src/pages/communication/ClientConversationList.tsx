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
    <div className="border rounded-lg overflow-hidden flex flex-col">
      <div className="p-3 border-b bg-muted/30 space-y-2">
        <p className="text-sm font-semibold">Clientes ({summaries.length})</p>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          />
          <Input
            aria-label="Buscar conversas por cliente ou mensagem"
            className="pl-9"
            data-testid="input-client-conversation-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente ou mensagem"
            value={query}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y">
        {filteredSummaries.length === 0 ? (
          <div
            className="p-6 text-center text-sm text-muted-foreground"
            data-testid="text-no-conversation-search-results"
            role="status"
          >
            Nenhuma conversa encontrada.
          </div>
        ) : (
          filteredSummaries.map((summary) => {
            const isSelected = selectedClientId === summary.clientId;
            return (
              <button
                aria-pressed={isSelected}
                className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                data-testid={`button-conversation-${summary.clientId}`}
                key={summary.clientId}
                onClick={() => onSelect(summary.clientId)}
                type="button"
              >
                <div className="flex items-start justify-between">
                  <p className="font-medium text-sm truncate" data-testid={`text-conversation-client-${summary.clientId}`}>
                    {summary.clientName}
                  </p>
                  <span className="text-xs text-muted-foreground shrink-0 ml-1">
                    {formatConversationDate(summary.lastMessage.sentAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {summary.lastMessage.actor === "client"
                    ? "Cliente"
                    : summary.lastMessage.actor === "ai"
                      ? "Atendimento IA"
                      : "Equipe"}
                  : {summary.lastMessage.content}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    className={`text-xs ${channelColors[summary.lastMessage.channel] ?? ""}`}
                    variant="secondary"
                  >
                    {channelLabels[summary.lastMessage.channel] ?? summary.lastMessage.channel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{summary.count} msg</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}