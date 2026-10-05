import { useLayoutEffect, useRef, type FormEvent } from "react";
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
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaExpiredAt?: string | null;
}

export type ClientLinkStatus = "checking" | "valid" | "missing" | "unavailable";

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

const INLINE_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
]);
const INLINE_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const INLINE_VIDEO_TYPES = new Set(["video/3gpp", "video/mp4", "video/webm"]);

export function MessageMediaAttachment({
  url,
  mimeType,
  fileName,
  expiredAt,
}: {
  url: string | null | undefined;
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
  expiredAt: string | null | undefined;
}) {
  if (expiredAt) {
    return (
      <span className="mt-1 block text-xs opacity-80" role="status">
        Anexo expirado após 90 dias
      </span>
    );
  }

  if (!url) {
    return (
      <span className="mt-1 block text-xs opacity-80">
        {mimeType ? "Anexo indisponível" : "Mídia anexada"}
      </span>
    );
  }

  const normalizedMimeType = mimeType?.toLowerCase() ?? "";
  if (INLINE_AUDIO_TYPES.has(normalizedMimeType)) {
    return (
      <audio
        className="mt-2 block w-full max-w-full"
        controls
        preload="none"
        src={url}
        aria-label={fileName || "Áudio recebido"}
      />
    );
  }
  if (INLINE_IMAGE_TYPES.has(normalizedMimeType)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
        <img
          src={url}
          alt={fileName || "Imagem recebida"}
          loading="lazy"
          className="max-h-64 max-w-full rounded-md object-contain"
        />
      </a>
    );
  }
  if (INLINE_VIDEO_TYPES.has(normalizedMimeType)) {
    return (
      <video
        className="mt-2 block max-h-64 max-w-full rounded-md"
        controls
        preload="metadata"
        src={url}
        aria-label={fileName || "Vídeo recebido"}
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={fileName || undefined}
      className="mt-1 block text-xs underline underline-offset-2"
    >
      {fileName || "Baixar anexo"}
    </a>
  );
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
  failedConversationLabels?: string[];
  onRetryConversationAiMessages: () => unknown;
  selectedWhatsAppConversation: AiConversation | null;
  selectedClientLinkStatus: ClientLinkStatus;
  onRetryClientLinkCheck: () => unknown;
  onReassociateConversation: () => void;
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
  failedConversationLabels = [],
  onRetryConversationAiMessages,
  selectedWhatsAppConversation,
  selectedClientLinkStatus,
  onRetryClientLinkCheck,
  onReassociateConversation,
  inboxChannel,
  setInboxChannel,
  inboxMessage,
  setInboxMessage,
  handleSendInbox,
  sendingMessage,
}: ConversationsTabProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const previousClientIdRef = useRef(selectedClientId);
  const followLatestMessageRef = useRef(true);

  useLayoutEffect(() => {
    if (previousClientIdRef.current !== selectedClientId) {
      previousClientIdRef.current = selectedClientId;
      followLatestMessageRef.current = true;
    }
    const timeline = timelineRef.current;
    if (timeline && followLatestMessageRef.current) {
      timeline.scrollTop = timeline.scrollHeight;
    }
  }, [conversationMessages, selectedClientId]);

  const handleTimelineScroll = () => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    followLatestMessageRef.current =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 48;
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">Histórico de conversas</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Mensagens recebidas, respostas do Atendimento IA e envios da equipe aparecem juntos por cliente.
            A aba Atendimento IA mantém a triagem e o contexto completo do bot.
          </p>
        </div>
        <span className="hidden shrink-0 text-[11px] font-medium text-muted-foreground sm:block">
          WhatsApp e e-mail
        </span>
      </div>
      {loadingMessages || loadingOutboundMessages || loadingAiInbox ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(270px,0.82fr)_minmax(0,1.8fr)]">
          <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[68px] w-full rounded-lg" />)}
          </div>
          <div><Skeleton className="h-[400px] w-full rounded-xl md:h-[min(76dvh,760px)]" /></div>
        </div>
      ) : messagesError ? (
        <QueryErrorState resourceLabel="as mensagens" error={messagesQueryError} onRetry={() => { void refetchMessages(); }} />
      ) : outboundMessagesError || aiInboxError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
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
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center text-muted-foreground">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-primary">
            <MessageSquare className="h-6 w-6" aria-hidden="true" />
          </span>
          <p className="font-semibold text-foreground">Nenhuma conversa com mensagens ainda.</p>
          <p className="mt-1 max-w-sm text-sm">As conversas recebidas e as mensagens enviadas aparecerão aqui.</p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:h-[min(76dvh,760px)] md:min-h-[560px] md:grid-cols-[minmax(270px,0.82fr)_minmax(0,1.8fr)]">
          <ClientConversationList
            channelColors={channelColors}
            channelLabels={channelLabels}
            onSelect={onSelectClient}
            selectedClientId={selectedClientId}
            summaries={summaries}
          />
          <section
            aria-label={selectedClientId ? `Conversa com ${selectedClientName ?? "cliente"}` : "Conversa selecionada"}
            className="flex min-h-[64dvh] min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm md:min-h-0"
          >
            {!selectedClientId ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-foreground">Escolha uma conversa</p>
                <p className="mt-1 text-xs">Selecione um cliente na lista para abrir o histórico.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-secondary/35 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
                      {(selectedClientName ?? "C").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toLocaleUpperCase("pt-BR")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{selectedClientName ?? "Conversa"}</p>
                      <p className="text-xs text-muted-foreground">{conversationMessages.length} mensagem(ns)</p>
                    </div>
                  </div>
                  <Select value={inboxChannel} onValueChange={(value) => setInboxChannel(value as "email" | "whatsapp")}>
                    <SelectTrigger
                      data-testid="select-conversation-channel"
                      className="h-9 w-[142px] border-border/80 bg-card text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((channel) => (
                        <SelectItem key={channel.value} value={channel.value}>{channel.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div
                  aria-label="Histórico de mensagens"
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/55 px-3 py-4 sm:px-5"
                  data-testid="client-conversation-timeline"
                  onScroll={handleTimelineScroll}
                  ref={timelineRef}
                  role="log"
                  aria-live="polite"
                >
                  {loadingConversationAiMessages && (
                    <p className="rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground" role="status">Carregando mensagens recebidas…</p>
                  )}
                  {conversationAiError && (
                    <div
                      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive sm:flex-row sm:items-center"
                      data-testid="conversation-ai-history-error"
                      role="alert"
                    >
                      <div className="min-w-0 flex-1">
                        <p>{conversationAiError}</p>
                        {failedConversationLabels.length > 0 && (
                          <div className="mt-2">
                            <p className="font-medium">Sessões com histórico incompleto:</p>
                            <ul
                              className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground"
                              data-testid="failed-conversation-history-labels"
                            >
                              {failedConversationLabels.map((label, index) => (
                                <li key={`${label}-${index}`}>{label}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <Button
                        data-testid="button-retry-conversation-ai-messages"
                        variant="outline"
                        size="sm"
                        onClick={() => { void onRetryConversationAiMessages(); }}
                      >
                        Tentar novamente
                      </Button>
                    </div>
                  )}
                  {conversationMessages.length === 0 && !loadingConversationAiMessages && !conversationAiError && (
                    <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-muted-foreground">
                      <MessageSquare className="mb-2 h-5 w-5 opacity-60" aria-hidden="true" />
                      <p className="text-sm font-medium text-foreground">Ainda não há mensagens neste histórico.</p>
                    </div>
                  )}
                  {conversationMessages.map((message) => (
                    <div key={message.id} className={`flex min-w-0 ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className="min-w-0 max-w-[min(88%,34rem)]">
                        <p className={`mb-1 text-[11px] font-medium text-muted-foreground ${message.direction === "outbound" ? "text-right" : ""}`}>
                          {actorLabel(message.actor)}
                        </p>
                        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
                          message.direction === "outbound"
                            ? "rounded-tr-md bg-primary text-primary-foreground"
                            : "rounded-tl-md border border-border/70 bg-card text-card-foreground"
                        }`}>
                          {message.content || (message.mediaUrl ? "Mídia recebida" : "Mensagem sem texto")}
                          {(message.mediaUrl || message.mediaMimeType || message.mediaExpiredAt) && (
                            <MessageMediaAttachment
                              url={message.mediaUrl}
                              mimeType={message.mediaMimeType}
                              fileName={message.mediaFileName}
                              expiredAt={message.mediaExpiredAt}
                            />
                          )}
                        </div>
                        <div className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 ${message.direction === "outbound" ? "justify-end" : ""}`}>
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {new Date(message.sentAt).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                          {message.status && (
                            <span className="text-[10px] text-muted-foreground">
                              {statusIcons[message.status] ?? null} {timelineStatusLabel(message.status)}
                            </span>
                          )}
                          <Badge className={`h-5 rounded-md px-1.5 text-[10px] ${channelColors[message.channel] ?? ""}`} variant="secondary">
                            {channelLabels[message.channel] ?? message.channel}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border/70 bg-card px-3 py-3 sm:px-4">
                  {selectedClientLinkStatus === "checking" && (
                    <p className="mb-2 text-xs text-muted-foreground" role="status">
                      Verificando o vínculo do cliente antes de liberar o envio…
                    </p>
                  )}
                  {selectedClientLinkStatus === "missing" && (
                    <div
                      className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                      data-testid="client-link-missing-warning"
                      role="alert"
                    >
                      <p>Este histórico não está vinculado a um cliente válido desta agência. O envio está bloqueado.</p>
                      {selectedWhatsAppConversation ? (
                        <>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Reassocie o atendimento a um cadastro existente na aba Atendimento IA e depois selecione o cliente atualizado.
                          </p>
                          <Button
                            className="mt-2"
                            data-testid="button-reassociate-client-conversation"
                            onClick={onReassociateConversation}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Abrir atendimento para reassociar
                          </Button>
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Selecione um cliente válido ou peça à equipe para corrigir o vínculo deste histórico.
                        </p>
                      )}
                    </div>
                  )}
                  {selectedClientLinkStatus === "unavailable" && (
                    <div
                      className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                      data-testid="client-link-check-unavailable"
                      role="alert"
                    >
                      <p>Não foi possível confirmar o cadastro agora. O envio ficará bloqueado até a verificação.</p>
                      <Button
                        className="mt-2"
                        data-testid="button-retry-client-link-check"
                        onClick={() => { void onRetryClientLinkCheck(); }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Verificar novamente
                      </Button>
                    </div>
                  )}
                  {selectedWhatsAppConversation?.status === "opted_out" && inboxChannel === "whatsapp" && (
                    <p className="mb-2 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive" role="alert">
                      Este contato pediu para não receber mensagens pelo WhatsApp. Selecione outro canal se houver autorização.
                    </p>
                  )}
                  <form onSubmit={handleSendInbox} className="flex min-w-0 items-center gap-2">
                    <input
                      data-testid="input-conversation-message"
                      type="text"
                      className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder={selectedWhatsAppConversation && inboxChannel === "whatsapp"
                        ? "Escreva uma resposta pelo WhatsApp..."
                        : "Escreva uma nova mensagem..."}
                      aria-label="Nova mensagem para o cliente"
                      value={inboxMessage}
                      onChange={(event) => setInboxMessage(event.target.value)}
                      disabled={selectedClientLinkStatus !== "valid"}
                    />
                    <Button
                      data-testid="button-send-conversation-message"
                      type="submit"
                      size="sm"
                      className="h-10 w-10 shrink-0 rounded-lg"
                      aria-label="Enviar mensagem ao cliente"
                      disabled={
                        sendingMessage ||
                        !inboxMessage.trim() ||
                        selectedClientLinkStatus !== "valid" ||
                        (selectedWhatsAppConversation?.status === "opted_out" && inboxChannel === "whatsapp")
                      }
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </>
            )}
          </section>
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
                        <p>{message.content || (message.mediaUrl ? "Mídia recebida" : "Mensagem sem texto")}</p>
                        {(message.mediaUrl || message.mediaMimeType || message.mediaExpiredAt) && (
                          <MessageMediaAttachment
                            url={message.mediaUrl}
                            mimeType={message.mediaMimeType}
                            fileName={message.mediaFileName}
                            expiredAt={message.mediaExpiredAt}
                          />
                        )}
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