import type { FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { AiConversationMessage } from "@/lib/communicationTimeline";
import type { ClientConversationSummary, CommunicationTimelineEntry } from "@/lib/communicationTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { ClientConversationList } from "./ClientConversationList";

export interface AiConversation {
  id: string;
  clientId: string | null;
  clientName: string | null;
  channel: string;
  status: string;
  assignedUserId: string | null;
  sessionId: string | null;
  startedAt: string;
  createdAt: string;
  lastMessageId: string | null;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  lastMessageRole: string | null;
  lastMessageIsBot: boolean | null;
  lastMessageStatus: string | null;
  messageCount: number;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  isBot: boolean;
  sentAt: string;
  deliveryStatus?: string | null;
  mediaUrl?: string | null;
}

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
];

const statusIcons: Record<string, React.ReactNode> = {
  sent: <span aria-hidden="true">✓</span>,
  delivered: <span aria-hidden="true">✓✓</span>,
  read: <span aria-hidden="true">✓✓</span>,
  failed: <span aria-hidden="true">×</span>,
  pending: <span aria-hidden="true">◷</span>,
};

const statusLabels: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  failed: "Falhou",
  pending: "Pendente",
};

const outboundDeliveryStatusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  accepted: "Aceita pelo provedor",
  failed: "Falha confirmada",
  skipped: "Ignorada",
  unknown: "Resultado desconhecido",
};

function actorLabel(actor: "client" | "team" | "ai"): string {
  if (actor === "client") return "Cliente";
  if (actor === "ai") return "Atendimento IA";
  return "Equipe";
}

function timelineStatusLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === "received") return "Recebida";
  return statusLabels[status] ?? outboundDeliveryStatusLabels[status] ?? status;
}

interface ConversationsTabProps {
  channelColors: Record<string, string>;
  channelLabels: Record<string, string>;
  summaries: ClientConversationSummary[];
  selectedClientId: string | null;
  onSelectClient: (clientId: string) => void;
  loadingMessages: boolean;
  loadingOutboundMessages: boolean;
  loadingAiInbox: boolean;
  messagesError: boolean;
  messagesQueryError: unknown;
  outboundMessagesError: boolean;
  aiInboxError: string | null;
  refetchMessages: () => unknown;
  refetchOutboundMessages: () => unknown;
  fetchAiInbox: () => unknown;
  conversationMessages: CommunicationTimelineEntry[];
  selectedClientName: string | undefined;
  loadingConversationAiMessages: boolean;
  conversationAiError: string | null;
  selectedWhatsAppConversation: AiConversation | null;
  inboxChannel: "email" | "whatsapp";
  setInboxChannel: (channel: "email" | "whatsapp") => void;
  inboxMessage: string;
  setInboxMessage: (message: string) => void;
  handleSendInbox: (event: FormEvent<HTMLFormElement>) => void;
  sendingMessage: boolean;
}

export function ConversationsTab({
  channelColors,
  channelLabels,
  summaries,
  selectedClientId,
  onSelectClient,
  loadingMessages,
  loadingOutboundMessages,
  loadingAiInbox,
  messagesError,
  messagesQueryError,
  outboundMessagesError,
  aiInboxError,
  refetchMessages,
  refetchOutboundMessages,
  fetchAiInbox,
  conversationMessages,
  selectedClientName,
  loadingConversationAiMessages,
  conversationAiError,
  selectedWhatsAppConversation,
  inboxChannel,
  setInboxChannel,
  inboxMessage,
  setInboxMessage,
  handleSendInbox,
  sendingMessage,
}: ConversationsTabProps) {
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Mensagens recebidas, respostas do Atendimento IA e envios da equipe aparecem juntos por cliente. A aba Atendimento IA mantém a triagem e o contexto completo do bot.
      </p>
      {loadingMessages || loadingOutboundMessages || loadingAiInbox ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          <div className="col-span-2"><Skeleton className="h-[400px] w-full" /></div>
        </div>
      ) : messagesError ? (
        <QueryErrorState resourceLabel="as mensagens" error={messagesQueryError} onRetry={() => { void refetchMessages(); }} />
      ) : outboundMessagesError || aiInboxError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <p>{aiInboxError ?? "Não foi possível carregar o histórico de entregas enviadas."}</p>
          <Button
            data-testid="button-retry-client-conversations"
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => {
              void Promise.all([
                refetchOutboundMessages(),
                fetchAiInbox(),
                refetchMessages(),
              ]);
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : summaries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">Nenhuma conversa com mensagens ainda.</p>
          <p className="text-sm mt-1">As conversas recebidas e as mensagens enviadas aparecerão aqui.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[520px]">
          <ClientConversationList
            channelColors={channelColors}
            channelLabels={channelLabels}
            onSelect={onSelectClient}
            selectedClientId={selectedClientId}
            summaries={summaries}
          />
          <div className="md:col-span-2 border rounded-lg overflow-hidden flex flex-col">
            {!selectedClientId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Selecione uma conversa para ver as mensagens</p>
                </div>
              </div>
            ) : (
              <>
                <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{selectedClientName}</p>
                    <p className="text-xs text-muted-foreground">{conversationMessages.length} mensagem(ns)</p>
                  </div>
                  <Select value={inboxChannel} onValueChange={(value) => setInboxChannel(value as "email" | "whatsapp")}>
                    <SelectTrigger data-testid="select-conversation-channel" className="w-32 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((channel) => (
                        <SelectItem key={channel.value} value={channel.value}>{channel.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {loadingConversationAiMessages && (
                    <p className="text-xs text-muted-foreground" role="status">Carregando mensagens recebidas…</p>
                  )}
                  {conversationAiError && (
                    <div className="flex items-center gap-2 text-xs text-destructive" role="alert">
                      <span>{conversationAiError}</span>
                      <Button data-testid="button-retry-conversation-ai-messages" variant="outline" size="sm" onClick={() => { void fetchAiInbox(); }}>
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {conversationMessages.map((message) => (
                    <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-xs">
                        <p className={`mb-0.5 text-xs font-medium ${message.direction === "outbound" ? "text-right" : ""}`}>
                          {actorLabel(message.actor)}
                        </p>
                        <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                          message.direction === "outbound"
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-muted rounded-tl-sm"
                        }`}>
                          {message.content || (message.mediaUrl ? "Mídia recebida" : "Mensagem sem texto")}
                          {message.mediaUrl && (
                            <span className="mt-1 block text-xs opacity-80">Mídia anexada</span>
                          )}
                        </div>
                        <div className={`flex items-center gap-1.5 mt-0.5 ${message.direction === "outbound" ? "justify-end" : ""}`}>
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.sentAt).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                          {message.status && (
                            <span className="text-xs text-muted-foreground">
                              {statusIcons[message.status] ?? null} {timelineStatusLabel(message.status)}
                            </span>
                          )}
                          <Badge className={`text-xs ${channelColors[message.channel] ?? ""}`} variant="secondary">
                            {channelLabels[message.channel] ?? message.channel}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t">
                  {selectedWhatsAppConversation?.status === "opted_out" && inboxChannel === "whatsapp" && (
                    <p className="mb-2 text-xs text-destructive" role="alert">
                      Este contato pediu para não receber mensagens pelo WhatsApp. Selecione outro canal se houver autorização.
                    </p>
                  )}
                  <form onSubmit={handleSendInbox} className="flex gap-2">
                    <input
                      data-testid="input-conversation-message"
                      type="text"
                      className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={selectedWhatsAppConversation && inboxChannel === "whatsapp"
                        ? "Escreva uma resposta pelo WhatsApp..."
                        : "Escreva uma nova mensagem..."}
                      aria-label="Nova mensagem para o cliente"
                      value={inboxMessage}
                      onChange={(event) => setInboxMessage(event.target.value)}
                    />
                    <Button
                      data-testid="button-send-conversation-message"
                      type="submit"
                      size="sm"
                      aria-label="Enviar mensagem ao cliente"
                      disabled={
                        sendingMessage ||
                        !inboxMessage.trim() ||
                        (selectedWhatsAppConversation?.status === "opted_out" && inboxChannel === "whatsapp")
                      }
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface AiInboxTabProps {
  conversations: AiConversation[];
  selectedConversationId: string | null;
  selectedMessages: AiMessage[];
  loading: boolean;
  error: string | null;
  reply: string;
  sendingReply: boolean;
  onSelectConversation: (id: string) => void;
  onRefresh: () => unknown;
  onReplyChange: (value: string) => void;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
}

export function AiInboxTab({
  conversations,
  selectedConversationId,
  selectedMessages,
  loading,
  error,
  reply,
  sendingReply,
  onSelectConversation,
  onRefresh,
  onReplyChange,
  onReply,
}: AiInboxTabProps) {
  return (
    <>
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          <div className="col-span-2"><Skeleton className="h-[400px] w-full" /></div>
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
          <p>{error}</p>
          <Button data-testid="button-retry-ai-inbox" className="mt-3" variant="outline" size="sm" onClick={() => { void onRefresh(); }}>
            Tentar novamente
          </Button>
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">Nenhum atendimento WhatsApp ainda.</p>
          <p className="text-sm mt-1">As conversas recebidas pela integração aparecerão aqui.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[520px]">
          <div className="border rounded-lg overflow-hidden flex flex-col">
            <div className="p-3 border-b bg-muted/30">
              <p className="text-sm font-semibold">Atendimentos ({conversations.length})</p>
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  data-testid={`button-ai-conversation-${conversation.id}`}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${selectedConversationId === conversation.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm truncate">{conversation.sessionId ?? "Contato sem telefone"}</p>
                    <Badge variant={conversation.status === "human_handoff" ? "default" : "secondary"}>
                      {conversation.status === "human_handoff" ? "Humano" : conversation.status === "opted_out" ? "Opt-out" : "IA"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(conversation.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 border rounded-lg overflow-hidden flex flex-col">
            {!selectedConversationId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p className="text-sm">Selecione um atendimento para ver o histórico.</p>
              </div>
            ) : (
              <>
                <div className="p-3 border-b bg-muted/30">
                  <p className="font-semibold text-sm">Atendimento WhatsApp</p>
                  <p className="text-xs text-muted-foreground">A IA interrompe respostas ao detectar uma solicitação de atendimento humano.</p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {selectedMessages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-xs rounded-lg px-3 py-2 text-sm ${message.role === "user" ? "bg-muted" : message.isBot ? "bg-primary/10 text-foreground" : "bg-primary text-primary-foreground"}`}>
                        <p>{message.content}</p>
                        <p className="mt-1 text-[10px] opacity-70">
                          {message.isBot ? "IA" : message.role === "user" ? "Cliente" : "Equipe"} · {new Date(message.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t">
                  <form onSubmit={onReply} className="flex gap-2">
                    <input
                      data-testid="input-ai-inbox-reply"
                      type="text"
                      className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Responder como equipe..."
                      value={reply}
                      onChange={(event) => onReplyChange(event.target.value)}
                    />
                    <Button data-testid="button-send-ai-inbox-reply" type="submit" size="sm" disabled={sendingReply || !reply.trim()}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}