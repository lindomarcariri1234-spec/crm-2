import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getListChatbotMessagesQueryKey,
  getListSupportQueuesQueryKey,
  getListSupportQuickRepliesQueryKey,
  getListSupportTicketEventsQueryKey,
  getListSupportTicketsQueryKey,
  getListUsersQueryKey,
  useApplySupportTicketAction,
  useCreateSupportQueue,
  useCreateSupportQuickReply,
  useDeleteSupportQuickReply,
  useGetMe,
  useListChatbotMessages,
  useListSupportQueues,
  useListSupportQuickReplies,
  useListSupportTicketEvents,
  useListSupportTickets,
  useListUsers,
  useReplyToSupportTicket,
  useUpdateSupportQueue,
  useUpdateSupportQuickReply,
  type ChatbotMessage,
  type SupportQueue,
  type SupportQuickReply,
  type SupportTicketEvent,
  type SupportTicketListItem,
} from "@workspace/api-client-react";
import { MANAGEMENT_ROLES } from "@workspace/permissions";
import {
  ArrowLeft,
  Archive,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  TicketCheck,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSupportTicketStream } from "@/hooks/useSupportTicketStream";

type TicketStatus = "all" | "pending" | "open" | "resolved";
type AssignmentFilter = "all" | "mine" | "unassigned";
type ReplyDraft = { id?: string; title: string; shortcut: string; content: string; queueId: string; isActive?: boolean };
type SupportMessage = ChatbotMessage;
type SupportEvent = SupportTicketEvent;

const statusCopy: Record<string, string> = {
  pending: "Aguardando equipe",
  open: "Em atendimento",
  resolved: "Resolvido",
};
const priorityCopy: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};
const statusAccent: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  open: "border-teal-200 bg-teal-50 text-teal-800",
  resolved: "border-stone-200 bg-stone-100 text-stone-600",
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function dateLabel(date: string, includeDate = false) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", includeDate
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function relativeLabel(date: string) {
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  if (elapsed < 60_000) return "agora";
  if (elapsed < 3_600_000) return `há ${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `há ${Math.floor(elapsed / 3_600_000)} h`;
  return dateLabel(date, true);
}

function SupportTicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: SupportTicketListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`ticket-row-${ticket.id}`}
      onClick={onSelect}
      className={`group w-full border-b border-[#e9e4da] px-4 py-4 text-left transition-colors hover:bg-[#f7f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-700 ${selected ? "bg-[#edf4f0] shadow-[inset_3px_0_0_#2b766d]" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e4e0d5] font-semibold text-[#655d4e]">
          {initials(ticket.clientName || "Viajante")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[14px] font-semibold text-[#263b37]" data-testid={`text-traveler-${ticket.id}`}>
              {ticket.clientName || "Viajante sem identificação"}
            </p>
            <span className="shrink-0 pt-0.5 text-[11px] text-[#857e70]">{relativeLabel(ticket.lastMessageAt)}</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {ticket.priority === "urgent" || ticket.priority === "high" ? (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ticket.priority === "urgent" ? "bg-[#c55b43]" : "bg-[#d39a3a]"}`} />
            ) : null}
            <p className="truncate text-[12px] text-[#716e64]">{ticket.lastMessageContent || ticket.subject || "Conversa iniciada"}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusAccent[ticket.status] ?? statusAccent.pending}`}>
              {statusCopy[ticket.status] ?? ticket.status}
            </span>
            <span className="rounded-full bg-[#f0eee8] px-2 py-0.5 text-[10px] text-[#706d63]">{ticket.queueName || "Sem fila"}</span>
            {ticket.whatsappConnectionName ? (
              <span className="rounded-full bg-[#e7f0ed] px-2 py-0.5 text-[10px] text-[#34665d]">
                {ticket.whatsappConnectionName}
              </span>
            ) : null}
            {ticket.assignedUserName ? (
              <span className="flex items-center gap-1 text-[10px] text-[#79756b]">
                <UserRound className="h-3 w-3" />{ticket.assignedUserName.split(" ")[0]}
              </span>
            ) : <span className="text-[10px] text-[#a07432]">Sem responsável</span>}
            <span className="ml-auto text-[10px] text-[#9a9488]">{ticket.messageCount} mensagens</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function SupportTicketsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<TicketStatus>("all");
  const [queueFilter, setQueueFilter] = useState("all");
  const [assignment, setAssignment] = useState<AssignmentFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [queueDraft, setQueueDraft] = useState("");
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueName, setEditingQueueName] = useState("");
  const [quickDraft, setQuickDraft] = useState<ReplyDraft | null>(null);
  const [showArchivedReplies, setShowArchivedReplies] = useState(false);
  const [sendingAttempt, setSendingAttempt] = useState<{ content: string; key: string } | null>(null);

  const { data: me } = useGetMe({ query: { enabled: true, queryKey: getGetMeQueryKey() } });
  const canManage = Boolean(me && MANAGEMENT_ROLES.includes(me.role));
  const queuesQuery = useListSupportQueues({
    query: { enabled: true, queryKey: getListSupportQueuesQueryKey() },
  });
  const queues = (queuesQuery.data ?? []) as SupportQueue[];
  const usersQuery = useListUsers({ query: { enabled: true, queryKey: getListUsersQueryKey() } });
  const users = (usersQuery.data ?? []).filter((user) => user.isActive && user.tenantId === me?.tenantId);
  const ticketParams = useMemo(() => ({
    status,
    queueId: queueFilter === "all" ? undefined : queueFilter,
    assignedUserId: assignment === "mine" ? me?.id : assignment === "unassigned" ? "unassigned" : undefined,
    search: search.trim() || undefined,
    limit: 100,
    offset: 0,
  }), [status, queueFilter, assignment, me?.id, search]);
  const ticketsQuery = useListSupportTickets(ticketParams, {
    query: { enabled: true, queryKey: getListSupportTicketsQueryKey(ticketParams) },
  });
  const tickets = (ticketsQuery.data?.items ?? []) as SupportTicketListItem[];
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const selectedTicketId = selectedTicket?.id ?? null;
  const selectedConversationId = selectedTicket?.conversationId ?? null;
  const messagesQuery = useListChatbotMessages(selectedTicket?.conversationId ?? "", { ticketId: selectedTicket?.id ?? "" }, {
    query: {
      enabled: Boolean(selectedTicket),
      queryKey: getListChatbotMessagesQueryKey(selectedTicket?.conversationId ?? "", { ticketId: selectedTicket?.id ?? "" }),
    },
  });
  const eventsQuery = useListSupportTicketEvents(selectedTicket?.id ?? "", {
    query: {
      enabled: Boolean(selectedTicket),
      queryKey: getListSupportTicketEventsQueryKey(selectedTicket?.id ?? ""),
    },
  });
  const quickReplyParams = { includeInactive: canManage && showArchivedReplies };
  const quickRepliesQuery = useListSupportQuickReplies(quickReplyParams, {
    query: { enabled: true, queryKey: getListSupportQuickRepliesQueryKey(quickReplyParams) },
  });
  const quickReplies = ((quickRepliesQuery.data ?? []) as SupportQuickReply[]).filter((item) =>
    item.isActive && (!item.queueId || item.queueId === selectedTicket?.queueId));

  const refreshTicketData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
    if (selectedTicketId && selectedConversationId) {
      void queryClient.invalidateQueries({ queryKey: getListChatbotMessagesQueryKey(selectedConversationId, { ticketId: selectedTicketId }) });
      void queryClient.invalidateQueries({ queryKey: getListSupportTicketEventsQueryKey(selectedTicketId) });
    }
  }, [queryClient, selectedConversationId, selectedTicketId]);
  const refreshTicketFromStream = useCallback((ticketId: string) => {
    void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
    if (ticketId !== selectedTicketId || !selectedTicketId || !selectedConversationId) return;
    void queryClient.invalidateQueries({ queryKey: getListChatbotMessagesQueryKey(selectedConversationId, { ticketId: selectedTicketId }) });
    void queryClient.invalidateQueries({ queryKey: getListSupportTicketEventsQueryKey(selectedTicketId) });
  }, [queryClient, selectedConversationId, selectedTicketId]);
  const refreshQueuesFromStream = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSupportQueuesQueryKey() });
  }, [queryClient]);
  const refreshAfterStreamReconnect = useCallback(() => {
    refreshTicketData();
    void queryClient.invalidateQueries({ queryKey: getListSupportQueuesQueryKey() });
  }, [queryClient, refreshTicketData]);
  useSupportTicketStream({
    tenantId: me?.tenantId,
    enabled: Boolean(me?.tenantId),
    onOpen: refreshAfterStreamReconnect,
    onTicketUpdate: refreshTicketFromStream,
    onQueuesUpdate: refreshQueuesFromStream,
  });
  const refreshCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: getListSupportQueuesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSupportQuickRepliesQueryKey() });
  };
  const applyAction = useApplySupportTicketAction({ mutation: { onSuccess: refreshTicketData } });
  const replyMutation = useReplyToSupportTicket({
    mutation: {
      onSuccess: (result: { deliveryQueued: boolean }) => {
        setReply("");
        setSendingAttempt(null);
        refreshTicketData();
        toast({
          title: result.deliveryQueued ? "Resposta colocada na fila" : "Resposta enviada",
          description: result.deliveryQueued
            ? "A mensagem foi aceita e está aguardando entrega pelo WhatsApp."
            : "A resposta foi registrada na conversa.",
        });
      },
    },
  });
  const createQueue = useCreateSupportQueue({ mutation: { onSuccess: refreshCatalog } });
  const updateQueue = useUpdateSupportQueue({ mutation: { onSuccess: refreshCatalog } });
  const createQuickReply = useCreateSupportQuickReply({ mutation: { onSuccess: refreshCatalog } });
  const updateQuickReply = useUpdateSupportQuickReply({ mutation: { onSuccess: refreshCatalog } });
  const archiveQuickReply = useDeleteSupportQuickReply({ mutation: { onSuccess: refreshCatalog } });

  const runAction = (action: "claim" | "assign" | "transfer" | "resolve" | "reopen" | "set_priority", extra: { assignedUserId?: string | null; queueId?: string | null; priority?: "low" | "normal" | "high" | "urgent" } = {}) => {
    if (!selectedTicket) return;
    applyAction.mutate({ id: selectedTicket.id, data: { action, ...extra } }, {
      onError: () => toast({ title: "Não foi possível atualizar o chamado", description: "Tente novamente em instantes.", variant: "destructive" }),
    });
  };

  const submitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = reply.trim();
    if (!selectedTicket || !content || replyMutation.isPending) return;
    // Reuse the key only when retrying exactly the same content after an uncertain result.
    const attempt = sendingAttempt?.content === content ? sendingAttempt : { content, key: crypto.randomUUID() };
    setSendingAttempt(attempt);
    const idempotencyKey = attempt.key;
    replyMutation.mutate({ id: selectedTicket.id, data: { content, idempotencyKey } }, {
      onError: () => toast({ title: "Falha ao enviar a resposta", description: "A mensagem não foi confirmada. Você pode tentar novamente com segurança.", variant: "destructive" }),
    });
  };

  const submitQueue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = queueDraft.trim();
    if (name.length < 2) return;
    createQueue.mutate({ data: { name } }, {
      onSuccess: () => { setQueueDraft(""); toast({ title: "Fila criada" }); },
      onError: () => toast({ title: "Não foi possível criar a fila", variant: "destructive" }),
    });
  };

  const submitQuickReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quickDraft) return;
    const payload = {
      title: quickDraft.title.trim(),
      shortcut: quickDraft.shortcut.trim(),
      content: quickDraft.content.trim(),
      queueId: quickDraft.queueId || undefined,
      isActive: quickDraft.isActive ?? true,
    };
    if (payload.title.length < 2 || payload.shortcut.length < 1 || payload.content.length < 1) return;
    const onSuccess = () => { setQuickDraft(null); toast({ title: "Resposta rápida salva" }); };
    const onError = () => toast({ title: "Não foi possível salvar a resposta rápida", variant: "destructive" });
    if (quickDraft.id) updateQuickReply.mutate({ id: quickDraft.id, data: payload }, { onSuccess, onError });
    else createQuickReply.mutate({ data: payload }, { onSuccess, onError });
  };

  const queuesLoading = queuesQuery.isLoading;
  const loading = ticketsQuery.isLoading;
  const currentQueueName = selectedTicket?.queueName || "Sem fila";
  const busy = applyAction.isPending;

  return (
    <section className="min-h-[650px] overflow-hidden rounded-2xl border border-[#e4dfd3] bg-[#fbfaf7] shadow-[0_12px_32px_rgba(56,49,35,.06)]" data-testid="support-tickets-inbox">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e8e3d8] bg-[#f6f4ed] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dcebe4] text-[#2a7166]"><MessageCircle className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold tracking-[-.02em] text-[#293a35]">Chamados de suporte</h2>
              <span className="rounded-full bg-[#e8e5dc] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[.08em] text-[#777266]">WhatsApp · equipe humana</span>
            </div>
            <p className="mt-0.5 text-xs text-[#817b6f]">A conversa original continua no WhatsApp; este chamado organiza a passagem para a equipe.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-[#d9e6dc] bg-[#edf4ed] px-3 py-1.5 text-[11px] text-[#4f6d5c] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4e9875]" /> Caixa atualizada sob demanda
          </div>
          {canManage && <Button variant="outline" size="sm" onClick={() => setManageOpen(true)} className="border-[#d9d4c8] bg-[#fbfaf7] text-[#4c5147]" data-testid="button-manage-support">
            <ShieldCheck className="mr-1.5 h-4 w-4" /> Gerenciar
          </Button>}
        </div>
      </header>

      <div className="grid min-h-[590px] grid-cols-1 md:grid-cols-[310px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className={`${selectedTicket ? "hidden md:flex" : "flex"} min-h-[590px] flex-col border-r border-[#e8e3d8] bg-[#fbfaf7]`}>
          <div className="border-b border-[#eee9df] p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a9488]" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar viajante ou mensagem" className="h-10 border-[#e3ded3] bg-white pl-9 text-[12px] placeholder:text-[#a09a8e]" data-testid="input-ticket-search" />
            </label>
            <div className="mt-3 flex gap-1 rounded-lg bg-[#f0eee7] p-1">
              {([["all", "Todos"], ["pending", "Aguardando"], ["open", "Em atendimento"], ["resolved", "Resolvidos"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setStatus(value)} className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-[10px] font-medium ${status === value ? "bg-white text-[#315d53] shadow-sm" : "text-[#817b70] hover:text-[#4d5b53]"}`} data-testid={`filter-ticket-status-${value}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select aria-label="Filtrar por fila" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)} className="h-9 min-w-0 rounded-md border border-[#e4dfd4] bg-white px-2 text-[11px] text-[#67645b]" data-testid="select-ticket-queue">
                <option value="all">Todas as filas</option>
                {queues.filter((queue) => queue.isActive).map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
              </select>
              <select aria-label="Filtrar por responsável" value={assignment} onChange={(event) => setAssignment(event.target.value as AssignmentFilter)} className="h-9 min-w-0 rounded-md border border-[#e4dfd4] bg-white px-2 text-[11px] text-[#67645b]" data-testid="select-ticket-assignee-filter">
                <option value="all">Qualquer pessoa</option>
                <option value="mine">Atribuídos a mim</option>
                <option value="unassigned">Sem responsável</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#999285]">Fila de atendimento</span>
            <span className="rounded-full bg-[#ece9e0] px-2 py-0.5 text-[10px] font-medium text-[#716d63]">{tickets.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <div className="space-y-2 px-4 py-2" aria-label="Carregando chamados">
              {[0, 1, 2, 3].map((item) => <div key={item} className="animate-pulse border-b border-[#eee9df] py-4"><div className="flex gap-3"><div className="h-10 w-10 rounded-full bg-[#e9e5dc]" /><div className="flex-1"><div className="h-3 w-2/3 rounded bg-[#e9e5dc]" /><div className="mt-3 h-3 w-full rounded bg-[#f0ede6]" /><div className="mt-3 h-4 w-3/4 rounded bg-[#f0ede6]" /></div></div></div>)}
            </div> : ticketsQuery.isError ? <div className="m-4 rounded-xl border border-[#ead9d0] bg-[#fff7f3] p-4">
              <CircleAlert className="h-5 w-5 text-[#b9644d]" /><p className="mt-2 text-sm font-medium text-[#6c4035]">Não foi possível carregar os chamados</p>
              <p className="mt-1 text-xs text-[#8f6c61]">Confira a conexão e tente novamente.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void ticketsQuery.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar novamente</Button>
            </div> : tickets.length === 0 ? <div className="mx-4 my-6 rounded-xl border border-dashed border-[#ddd7c9] bg-[#f7f5ef] px-4 py-8 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#ece9e0] text-[#888173]"><TicketCheck className="h-5 w-5" /></div>
              <p className="mt-3 text-sm font-medium text-[#55564e]">Nenhum chamado por aqui</p>
              <p className="mx-auto mt-1 max-w-[210px] text-xs leading-5 text-[#898477]">{search || status !== "all" || queueFilter !== "all" || assignment !== "all" ? "Ajuste os filtros para ver outros atendimentos." : "Quando a equipe assumir uma conversa, o chamado aparecerá nesta lista."}</p>
            </div> : tickets.map((ticket) => <SupportTicketRow key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} onSelect={() => { setSelectedId(ticket.id); setReply(""); setSendingAttempt(null); }} />)}
          </div>
          <div className="border-t border-[#e8e3d8] px-4 py-3 text-[10px] text-[#969083]">Chamados e status do chatbot são fluxos separados.</div>
        </aside>

        <main className={`${selectedTicket ? "flex" : "hidden md:flex"} min-w-0 flex-col bg-[#f7f6f1]`}>
          {!selectedTicket ? <div className="m-auto max-w-sm px-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-[#e5e0d5] bg-[#fbfaf7] text-[#71877a] shadow-sm"><MessageCircle className="h-7 w-7" /></div>
            <h3 className="mt-5 text-lg font-semibold tracking-[-.03em] text-[#33433b]">Atendimento com contexto</h3>
            <p className="mt-2 text-sm leading-6 text-[#817d71]">Selecione um chamado para acompanhar o histórico da conversa e assumir a próxima resposta.</p>
          </div> : <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e3d8] bg-[#fbfaf7] px-4 py-3.5 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 md:hidden" onClick={() => setSelectedId(null)} aria-label="Voltar para chamados" data-testid="button-back-to-tickets"><ArrowLeft className="h-4 w-4" /></Button>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e4e0d5] text-sm font-semibold text-[#655d4e]">{initials(selectedTicket.clientName || "Viajante")}</div>
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold text-[#293b36]">{selectedTicket.clientName || "Viajante sem identificação"}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-[#898477]">{selectedTicket.clientPhone || "Número não informado"} <span className="px-1">·</span> Chamado #{selectedTicket.id.slice(-6)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${statusAccent[selectedTicket.status] ?? statusAccent.pending}`}>{statusCopy[selectedTicket.status] ?? selectedTicket.status}</span>
                {selectedTicket.status === "resolved" ? (
                  <Button size="sm" onClick={() => runAction("reopen")} disabled={busy} className="h-8 bg-[#2c756a] text-white hover:bg-[#245f56]" data-testid="button-reopen-ticket"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reabrir chamado</Button>
                ) : selectedTicket.assignedUserId ? (
                  <Button variant="outline" size="sm" onClick={() => runAction("resolve")} disabled={busy} className="h-8 border-[#d8d4c9] bg-white text-[#53645a]" data-testid="button-resolve-ticket"><Check className="mr-1.5 h-3.5 w-3.5" /> Resolver</Button>
                ) : <Button size="sm" onClick={() => runAction("claim")} disabled={busy} className="h-8 bg-[#2c756a] text-white hover:bg-[#245f56]" data-testid="button-claim-ticket">{busy ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserRound className="mr-1.5 h-3.5 w-3.5" />} Assumir chamado</Button>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#e9e4da] bg-[#f4f2eb] px-4 py-2.5 text-[11px] sm:px-6">
              <label className="flex items-center gap-2 text-[#807b70]">
                <span>Fila</span>
                <select aria-label="Transferir chamado para fila" value={selectedTicket.queueId || ""} onChange={(event) => runAction("transfer", { queueId: event.target.value || null })} disabled={busy} className="max-w-[150px] rounded-md border border-[#e3ded2] bg-[#fbfaf7] px-2 py-1 text-[11px] text-[#4a554e]" data-testid="select-ticket-transfer-queue">
                  <option value="">Sem fila</option>
                  {queues.filter((queue) => queue.isActive).map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[#807b70]">
                <span>Responsável</span>
                <select aria-label="Atribuir responsável" value={selectedTicket.assignedUserId || ""} onChange={(event) => runAction("assign", { assignedUserId: event.target.value || null })} disabled={busy} className="max-w-[165px] rounded-md border border-[#e3ded2] bg-[#fbfaf7] px-2 py-1 text-[11px] text-[#4a554e]" data-testid="select-ticket-assignee">
                  <option value="">Sem responsável</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <label className="ml-auto flex items-center gap-2 text-[#807b70]">
                <span>Prioridade</span>
                <select aria-label="Alterar prioridade" value={selectedTicket.priority} onChange={(event) => runAction("set_priority", { priority: event.target.value as "low" | "normal" | "high" | "urgent" })} disabled={busy} className="rounded-md border border-[#e3ded2] bg-[#fbfaf7] px-2 py-1 text-[11px] font-medium text-[#4a554e]" data-testid="select-ticket-priority">
                  {Object.entries(priorityCopy).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-7">
              <div className="mb-5 flex items-center justify-center gap-2 text-[10px] text-[#999285]">
                <span className="h-px flex-1 bg-[#e6e1d6]" /><span>Conversa vinculada ao chamado · {currentQueueName}</span><span className="h-px flex-1 bg-[#e6e1d6]" />
              </div>
              {messagesQuery.isLoading ? <div className="space-y-5" aria-label="Carregando conversa">
                {[false, true, false].map((side, index) => <div key={index} className={`flex ${side ? "justify-end" : ""}`}><div className={`h-16 w-2/3 animate-pulse rounded-2xl ${side ? "bg-[#dcebe4]" : "bg-white"}`} /></div>)}
              </div> : messagesQuery.isError ? <div className="m-auto rounded-xl border border-[#ead9d0] bg-[#fff7f3] p-4 text-center">
                <p className="text-sm font-medium text-[#6c4035]">Falha ao carregar o histórico</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void messagesQuery.refetch()}>Tentar novamente</Button>
              </div> : (messagesQuery.data ?? []).length === 0 ? <div className="m-auto max-w-xs py-10 text-center text-sm text-[#898477]">Ainda não há mensagens vinculadas a este chamado.</div> : (
                <div className="space-y-3">
                  {((messagesQuery.data ?? []) as SupportMessage[]).map((message) => {
                    const fromTraveler = message.role === "user" || message.role === "client";
                    const fromTeam = !message.isBot && !fromTraveler;
                    const mediaType = message.mediaMimeType?.split("/")[0];
                    return <div key={message.id} className={`flex ${fromTeam ? "justify-end" : "justify-start"}`} data-testid={`message-${message.id}`}>
                      <article className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-[0_2px_6px_rgba(57,50,38,.04)] sm:max-w-[75%] ${fromTeam ? "rounded-br-md border border-[#d7e5dc] bg-[#e8f1eb] text-[#394b40]" : "rounded-bl-md border border-[#e6e1d7] bg-[#fffefa] text-[#4b4a43]"}`}>
                        <div className="mb-1 flex items-center gap-2 text-[10px] text-[#8c877b]">
                          <span className="font-medium">{fromTeam ? "Equipe" : fromTraveler ? (selectedTicket.clientName || "Viajante") : "Atendimento automatizado"}</span>
                          <span>{dateLabel(message.sentAt)}</span>
                        </div>
                        {message.mediaUrl && !message.mediaExpiredAt ? (
                          <div className="mb-2 overflow-hidden rounded-lg border border-[#dcd7cc] bg-[#f7f5ef]">
                            {mediaType === "image" ? <a href={message.mediaUrl} target="_blank" rel="noreferrer" aria-label="Abrir imagem anexada"><img src={message.mediaUrl} alt={message.mediaFileName || "Imagem enviada na conversa"} className="max-h-64 max-w-full object-contain" /></a>
                              : mediaType === "video" ? <video controls src={message.mediaUrl} className="max-h-64 max-w-full" />
                                : mediaType === "audio" ? <audio controls src={message.mediaUrl} className="max-w-full" />
                                  : <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-3 text-xs text-[#41685e]"><Paperclip className="h-4 w-4" />{message.mediaFileName || "Abrir anexo"}</a>}
                            {message.mediaMimeType && <div className="px-2 py-1 text-[9px] text-[#8d8779]">{message.mediaFileName || message.mediaMimeType}</div>}
                          </div>
                        ) : message.mediaExpiredAt ? <div className="mb-2 rounded-lg bg-[#f1eee7] px-3 py-2 text-[11px] text-[#858072]">Mídia não está mais disponível.</div> : null}
                        {message.content && <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.55]">{message.content}</p>}
                      </article>
                    </div>;
                  })}
                </div>
              )}
              <div className="mt-7 border-t border-dashed border-[#ded9ce] pt-4">
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium text-[#777266]"><Clock3 className="h-3.5 w-3.5" /> Histórico do chamado <ChevronDown className="ml-auto h-3.5 w-3.5" /></summary>
                  {eventsQuery.isLoading ? <p className="py-3 text-xs text-[#999285]">Carregando histórico…</p> : eventsQuery.isError ? <button className="py-3 text-xs text-[#a25340]" type="button" onClick={() => void eventsQuery.refetch()}>Não foi possível carregar. Tentar novamente</button> : (eventsQuery.data ?? []).length === 0 ? <p className="py-3 text-xs text-[#999285]">Nenhum evento registrado.</p> : <ol className="mt-3 space-y-3 border-l border-[#ddd7cb] pl-4">
                    {((eventsQuery.data ?? []) as SupportEvent[]).map((event) => <li key={event.id} className="relative text-[11px] text-[#716d63]"><span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full border-2 border-[#f7f6f1] bg-[#729589]" /><span className="font-medium text-[#514f47]">{event.eventType.replaceAll("_", " ")}</span><span className="ml-2 text-[#999285]">{dateLabel(event.createdAt, true)}</span>{event.actorName && <span className="ml-2 text-[#888274]">· {event.actorName}</span>}</li>)}
                  </ol>}
                </details>
              </div>
            </div>

            <div className="border-t border-[#e7e2d8] bg-[#fbfaf7] px-4 py-3 sm:px-6">
              {selectedTicket.status === "resolved" ? <div className="rounded-xl border border-[#e6e1d6] bg-[#f4f2ec] px-4 py-3 text-center text-xs text-[#817b6f]">Chamado resolvido. Reabra para enviar uma nova resposta.</div> : <>
                {quickReplies.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                  {quickReplies.map((quick) => <button key={quick.id} type="button" title={quick.content} onClick={() => setReply((current) => current ? `${current}\n${quick.content}` : quick.content)} className="shrink-0 rounded-full border border-[#dce4da] bg-[#f1f6f0] px-3 py-1.5 text-[10px] font-medium text-[#52705f] hover:bg-[#e7f0e8]" data-testid={`button-quick-reply-${quick.id}`}>{quick.shortcut}</button>)}
                </div>}
                {canManage && <div className="mb-2 flex justify-end"><button type="button" className="text-[10px] font-medium text-[#718276] hover:text-[#2c756a]" onClick={() => { setManageOpen(true); setQuickDraft({ title: "", shortcut: "", content: "", queueId: selectedTicket.queueId || "" }); }} data-testid="button-create-quick-reply-shortcut">Gerenciar respostas rápidas</button></div>}
                <form onSubmit={submitReply} className="flex items-end gap-2">
                  <Textarea value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={4000} rows={2} placeholder="Escreva uma resposta para o viajante…" className="max-h-36 min-h-[52px] resize-y rounded-xl border-[#e1dcd1] bg-white text-[13px] placeholder:text-[#a09a8e] focus-visible:ring-[#74a095]" disabled={replyMutation.isPending} data-testid="textarea-ticket-reply" />
                  <Button type="submit" disabled={!reply.trim() || replyMutation.isPending} className="h-11 shrink-0 rounded-xl bg-[#2c756a] px-4 text-white hover:bg-[#245f56]" data-testid="button-send-ticket-reply">
                    {replyMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="ml-2 hidden sm:inline">Enviar</span>
                  </Button>
                </form>
                <div className="mt-1.5 flex justify-between text-[9px] text-[#a09a8e]"><span>Enter envia · Shift + Enter quebra linha · Resposta pela conversa WhatsApp existente</span><span>{reply.length}/4000</span></div>
                {replyMutation.isError && <p className="mt-2 text-[11px] text-[#a25340]">Não confirmado. Tente enviar novamente; a chave desta tentativa será reutilizada.</p>}
              </>}
            </div>
          </>}
        </main>
      </div>

      {manageOpen && canManage && <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#252c27]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="support-manage-title">
        <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#e4dfd3] bg-[#fbfaf7] shadow-2xl sm:rounded-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e8e3d8] bg-[#f6f4ed] px-5 py-4">
            <div><h2 id="support-manage-title" className="font-semibold text-[#293a35]">Configurações de suporte</h2><p className="mt-0.5 text-xs text-[#817b6f]">Filas e respostas rápidas da equipe</p></div>
            <Button variant="ghost" size="icon" onClick={() => { setManageOpen(false); setQuickDraft(null); }} aria-label="Fechar configurações"><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-7 p-5">
            <section>
              <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-[#39463f]">Filas de atendimento</h3><p className="text-[11px] text-[#898477]">Organize para onde os chamados devem seguir.</p></div></div>
              <form onSubmit={submitQueue} className="flex gap-2">
                <Input value={queueDraft} onChange={(event) => setQueueDraft(event.target.value)} minLength={2} maxLength={80} placeholder="Ex.: Reservas e embarques" className="h-9 bg-white text-xs" data-testid="input-new-support-queue" />
                <Button type="submit" size="sm" disabled={createQueue.isPending || queueDraft.trim().length < 2} className="shrink-0 bg-[#2c756a] text-white hover:bg-[#245f56]" data-testid="button-create-support-queue">{createQueue.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}Criar fila</Button>
              </form>
              {queuesLoading ? <p className="py-4 text-xs text-[#898477]">Carregando filas…</p> : <div className="mt-3 divide-y divide-[#eee9df] rounded-xl border border-[#e8e3d8] bg-white">
                {queues.map((queue: SupportQueue) => <div key={queue.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  {editingQueueId === queue.id ? <form onSubmit={(event) => { event.preventDefault(); updateQueue.mutate({ id: queue.id, data: { name: editingQueueName.trim() } }, { onSuccess: () => setEditingQueueId(null) }); }} className="flex min-w-[200px] flex-1 gap-2">
                    <Input value={editingQueueName} onChange={(event) => setEditingQueueName(event.target.value)} minLength={2} maxLength={80} className="h-8 text-xs" autoFocus />
                    <Button size="sm" className="h-8 bg-[#2c756a]" disabled={updateQueue.isPending || editingQueueName.trim().length < 2}>Salvar</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingQueueId(null)}>Cancelar</Button>
                  </form> : <><div className="min-w-0 flex-1"><span className={`text-xs font-medium ${queue.isActive ? "text-[#4c5047]" : "text-[#a09a8e] line-through"}`}>{queue.name}</span>{queue.isDefault && <span className="ml-2 rounded-full bg-[#edf4ed] px-2 py-0.5 text-[9px] text-[#567060]">Padrão</span>}{!queue.isActive && <span className="ml-2 text-[9px] text-[#9b7667]">Arquivada</span>}</div>
                    <button type="button" className="rounded px-2 py-1 text-[10px] text-[#607b6e] hover:bg-[#f2f5f0]" onClick={() => { setEditingQueueId(queue.id); setEditingQueueName(queue.name); }} data-testid={`button-edit-queue-${queue.id}`}>Renomear</button>
                    {!queue.isDefault && <button type="button" className="rounded px-2 py-1 text-[10px] text-[#607b6e] hover:bg-[#f2f5f0]" onClick={() => updateQueue.mutate({ id: queue.id, data: { isDefault: true } })}>Definir padrão</button>}
                    {queue.isActive && <button type="button" className="rounded px-2 py-1 text-[10px] text-[#a15a44] hover:bg-[#fbf0eb]" onClick={() => updateQueue.mutate({ id: queue.id, data: { isActive: false } })} data-testid={`button-archive-queue-${queue.id}`}>Arquivar</button>}
                    {!queue.isActive && <button type="button" className="rounded px-2 py-1 text-[10px] text-[#607b6e] hover:bg-[#f2f5f0]" onClick={() => updateQueue.mutate({ id: queue.id, data: { isActive: true } })}>Reativar</button>}</>}
                </div>)}
                {!queues.length && <p className="px-3 py-4 text-center text-xs text-[#898477]">Nenhuma fila cadastrada.</p>}
              </div>}
            </section>
            <section className="border-t border-[#e9e4da] pt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-[#39463f]">Respostas rápidas</h3><p className="text-[11px] text-[#898477]">Textos prontos para responder sem perder o contexto.</p></div>
                <div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-[10px] text-[#817b6f]"><input type="checkbox" checked={showArchivedReplies} onChange={(event) => setShowArchivedReplies(event.target.checked)} /> Incluir arquivadas</label><Button size="sm" onClick={() => setQuickDraft({ title: "", shortcut: "", content: "", queueId: "" })} className="h-8 bg-[#2c756a] text-white hover:bg-[#245f56]" data-testid="button-add-quick-reply"><Plus className="mr-1 h-3.5 w-3.5" />Nova resposta</Button></div>
              </div>
              {quickDraft && <form onSubmit={submitQuickReply} className="mb-4 space-y-3 rounded-xl border border-[#dce5db] bg-[#f4f7f2] p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[10px] font-medium text-[#69675e]">Título<Input value={quickDraft.title} onChange={(event) => setQuickDraft({ ...quickDraft, title: event.target.value })} minLength={2} maxLength={80} required className="mt-1 h-8 bg-white text-xs" /></label>
                  <label className="text-[10px] font-medium text-[#69675e]">Atalho<Input value={quickDraft.shortcut} onChange={(event) => setQuickDraft({ ...quickDraft, shortcut: event.target.value })} required maxLength={32} placeholder="Ex.: boas-vindas" className="mt-1 h-8 bg-white text-xs" /></label>
                </div>
                <label className="block text-[10px] font-medium text-[#69675e]">Texto da resposta<Textarea value={quickDraft.content} onChange={(event) => setQuickDraft({ ...quickDraft, content: event.target.value })} required maxLength={2000} rows={3} className="mt-1 bg-white text-xs" /></label>
                <label className="block text-[10px] font-medium text-[#69675e]">Disponível em<select value={quickDraft.queueId} onChange={(event) => setQuickDraft({ ...quickDraft, queueId: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-[#e3ded2] bg-white px-2 text-xs"><option value="">Todas as filas</option>{queues.filter((queue) => queue.isActive).map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}</select></label>
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setQuickDraft(null)}>Cancelar</Button><Button type="submit" size="sm" disabled={createQuickReply.isPending || updateQuickReply.isPending} className="bg-[#2c756a] text-white">Salvar resposta</Button></div>
              </form>}
              {quickRepliesQuery.isLoading ? <p className="py-4 text-xs text-[#898477]">Carregando respostas…</p> : quickRepliesQuery.isError ? <button type="button" onClick={() => void quickRepliesQuery.refetch()} className="text-xs text-[#a25340]">Falha ao carregar respostas. Tentar novamente</button> : <div className="divide-y divide-[#eee9df] rounded-xl border border-[#e8e3d8] bg-white">
                {((quickRepliesQuery.data ?? []) as SupportQuickReply[]).filter((item) => showArchivedReplies || item.isActive).map((item) => <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-xs font-medium text-[#4c5047]">{item.title}</span><code className="shrink-0 rounded bg-[#f1efe8] px-1.5 py-0.5 text-[9px] text-[#777164]">{item.shortcut}</code>{!item.isActive && <span className="text-[9px] text-[#9b7667]">Arquivada</span>}</div><p className="mt-1 truncate text-[10px] text-[#898477]">{item.content}</p></div>
                  <button type="button" aria-label={`Editar ${item.title}`} className="rounded px-2 py-1 text-[10px] text-[#607b6e] hover:bg-[#f2f5f0]" onClick={() => setQuickDraft({ id: item.id, title: item.title, shortcut: item.shortcut, content: item.content, queueId: item.queueId || "", isActive: item.isActive })} data-testid={`button-edit-quick-reply-${item.id}`}>Editar</button>
                  {item.isActive && <button type="button" aria-label={`Arquivar ${item.title}`} className="rounded p-1.5 text-[#9b7667] hover:bg-[#fbf0eb]" onClick={() => archiveQuickReply.mutate({ id: item.id })} data-testid={`button-archive-quick-reply-${item.id}`}><Archive className="h-3.5 w-3.5" /></button>}
                </div>)}
                {((quickRepliesQuery.data ?? []) as SupportQuickReply[]).filter((item) => showArchivedReplies || item.isActive).length === 0 && <p className="px-3 py-4 text-center text-xs text-[#898477]">Nenhuma resposta rápida cadastrada.</p>}
              </div>}
            </section>
          </div>
        </div>
      </div>}
    </section>
  );
}
