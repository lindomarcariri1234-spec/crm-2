import { useState, useMemo, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListClientsQueryKey,
  getListMessagesQueryKey,
  getListMessageTemplatesQueryKey,
  getListOutboundMessagesQueryKey,
  getListOutboundProviderFailureSummaryQueryKey,
  useListMessages,
  useSendMessage,
  useListMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
  useCreateOutboundMessage,
  useListOutboundMessages,
  useListOutboundProviderFailureSummary,
  useReconcileOutboundDelivery,
  useRetryOutboundDelivery,
  useRetryUnknownOutboundDelivery,
  useGetMe,
} from "@workspace/api-client-react";
import { useListClients } from "@workspace/api-client-react";
import { ADMIN_ROLES, MANAGEMENT_ROLES } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Send,
  MessageSquare,
  Trash2,
  Pencil,
  CheckCheck,
  Check,
  Clock,
  XCircle,
  WholeWord,
  RefreshCcw,
  Mail,
  AlertTriangle,
  Download,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type {
  MessageTemplate,
  Message,
  OutboundMessage,
  OutboundDelivery,
  OutboundProviderFailureSummary,
  OutboundReconciliationResult,
} from "@workspace/api-client-react";
import { QueryErrorState } from "@/components/query-error-state";
import {
  extractTemplateVariables,
  prepareManualOutboundContent,
  resolveClientTemplate,
} from "@/lib/communicationTemplates";
import {
  buildClientConversationSummaries,
  buildClientTimeline,
  type AiConversationMessage,
} from "@/lib/communicationTimeline";
import {
  ConversationsTab,
  type AiConversation,
  type AiMessage,
} from "./communication/CommunicationInboxTabs";
import {
  MessagesTab,
  TemplatesTab,
} from "./communication/CommunicationCatalogTabs";
import {
  FailedEmailsTab,
  type FailedEmailSummary,
} from "./communication/FailedEmailsTab";
import {
  CommunicationHistoryTab,
  type CommunicationHistoryFilters,
} from "./communication/CommunicationHistoryTab";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const OUTBOUND_HISTORY_PAGE_SIZE = 50;
const NO_ASSOCIATED_CLIENT = "__no_associated_client__";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "sms", label: "SMS" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "internal", label: "Interno" },
];

const channelLabels: Record<string, string> = Object.fromEntries(
  CHANNELS.map(({ value, label }) => [value, label]),
);

const OUTBOUND_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
] as const;

const channelColors: Record<string, string> = {
  whatsapp: "bg-green-100 text-green-800",
  email: "bg-blue-100 text-blue-800",
  sms: "bg-orange-100 text-orange-800",
  instagram: "bg-pink-100 text-pink-800",
  telegram: "bg-sky-100 text-sky-800",
  internal: "bg-gray-100 text-gray-800",
};

const statusIcons: Record<string, React.ReactNode> = {
  sent: <Check className="w-3.5 h-3.5 text-muted-foreground" />,
  delivered: <CheckCheck className="w-3.5 h-3.5 text-blue-500" />,
  read: <CheckCheck className="w-3.5 h-3.5 text-green-500" />,
  failed: <XCircle className="w-3.5 h-3.5 text-red-500" />,
  pending: <Clock className="w-3.5 h-3.5 text-yellow-500" />,
};

const statusLabels: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  failed: "Falhou",
  pending: "Pendente",
};

const outboundStatusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  accepted: "Aceito pelo provedor",
  partial: "Falha parcial",
  failed: "Falhou",
  skipped: "Ignorado",
  unknown: "Resultado desconhecido",
};

const outboundDeliveryStatusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  accepted: "Aceita pelo provedor",
  failed: "Falha confirmada",
  skipped: "Ignorada",
  unknown: "Resultado desconhecido",
};

function timelineActorLabel(actor: "client" | "team" | "ai"): string {
  if (actor === "client") return "Cliente";
  if (actor === "ai") return "Atendimento IA";
  return "Equipe";
}

function timelineStatusLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === "received") return "Recebida";
  return statusLabels[status] ?? outboundDeliveryStatusLabels[status] ?? status;
}

type OutboundDeliveryFilterStatus = "all" | "pending" | "processing" | "accepted" | "failed" | "skipped" | "unknown";
type BounceTypeFilter = "all" | "permanent" | "temporary";
const UNKNOWN_PROVIDER_FILTER = "__unknown__";
const bounceTypeLabels: Record<Exclude<BounceTypeFilter, "all">, string> = {
  permanent: "Bounce permanente",
  temporary: "Falha temporária",
};

export default function Communication() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: currentUser } = useGetMe();
  const canManageTemplates = Boolean(currentUser && ADMIN_ROLES.includes(currentUser.role));
  const canReviewFailedEmails = Boolean(currentUser && MANAGEMENT_ROLES.includes(currentUser.role));
  const [tab, setTab] = useState("conversations");
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);

  const [sendChannel, setSendChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [emailSubject, setEmailSubject] = useState("Mensagem da agência");
  const [emailContent, setEmailContent] = useState("");
  const [whatsappContent, setWhatsappContent] = useState("");
  const [tplChannel, setTplChannel] = useState<string>("whatsapp");

  const [selectedConversationClientId, setSelectedConversationClientId] = useState<string | null>(null);
  const [inboxChannel, setInboxChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [inboxMessage, setInboxMessage] = useState("");
  const [aiConversations, setAiConversations] = useState<AiConversation[]>([]);
  const [selectedAiConversationId, setSelectedAiConversationId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [conversationAiMessages, setConversationAiMessages] = useState<AiConversationMessage[]>([]);
  const [loadingConversationAiMessages, setLoadingConversationAiMessages] = useState(false);
  const [conversationAiError, setConversationAiError] = useState<string | null>(null);
  const [aiInboxError, setAiInboxError] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState("");
  const [loadingAiInbox, setLoadingAiInbox] = useState(false);
  const [sendingAiReply, setSendingAiReply] = useState(false);
  const [associatingAiConversationId, setAssociatingAiConversationId] = useState<string | null>(null);
  const aiReplyKey = useRef<string | null>(null);
  const aiConversationRequestId = useRef(0);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [historyChannel, setHistoryChannel] = useState<"all" | "email" | "whatsapp">("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyDeliveryStatus, setHistoryDeliveryStatus] = useState<OutboundDeliveryFilterStatus>("all");
  const [historyBounceType, setHistoryBounceType] = useState<BounceTypeFilter>("all");
  const [historyProvider, setHistoryProvider] = useState("all");
  const [historyOrigin, setHistoryOrigin] = useState("all");
  const [historyClientId, setHistoryClientId] = useState("all");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyCampaignId, setHistoryCampaignId] = useState("");
  const [historyAutomationId, setHistoryAutomationId] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [loadedHistoryMessages, setLoadedHistoryMessages] = useState<OutboundMessage[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyExporting, setHistoryExporting] = useState<"csv" | "pdf" | null>(null);
  const [reconciliationDelivery, setReconciliationDelivery] = useState<OutboundDelivery | null>(null);
  const [reconciliationResult, setReconciliationResult] = useState<OutboundReconciliationResult | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  const [failedSummary, setFailedSummary] = useState<FailedEmailSummary[]>([]);
  const [loadingFailedSummary, setLoadingFailedSummary] = useState(false);
  const [failedSummaryError, setFailedSummaryError] = useState<string | null>(null);

  const resetHistoryPagination = () => {
    setHistoryOffset(0);
    setLoadedHistoryMessages([]);
    setHistoryHasMore(false);
  };
  const updateHistoryFilter = <T,>(setter: Dispatch<SetStateAction<T>>, value: T) => {
    setter(value);
    resetHistoryPagination();
  };

  const fetchFailedSummary = useCallback(async () => {
    setLoadingFailedSummary(true);
    setFailedSummaryError(null);
    try {
      const res = await fetch(`${BASE}/api/email-logs/failed-summary`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFailedSummary(data ?? []);
      } else if (res.status === 403) {
        setFailedSummaryError("Sem permissão para visualizar e-mails falhos. Entre em contato com um administrador.");
      } else {
        const body = await res.json().catch(() => ({}));
        setFailedSummaryError(body.error ?? "Erro ao carregar e-mails falhos. Tente novamente.");
      }
    } catch {
      setFailedSummaryError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setLoadingFailedSummary(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab) setTab(urlTab);
  }, []);

  useEffect(() => {
    if (tab === "failed-emails" && canReviewFailedEmails) {
      fetchFailedSummary();
    }
  }, [tab, canReviewFailedEmails, fetchFailedSummary]);

  useEffect(() => {
    if (tab === "failed-emails" && currentUser && !canReviewFailedEmails) {
      setTab("conversations");
    }
  }, [tab, currentUser, canReviewFailedEmails]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedClientSearch(clientSearch.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [clientSearch]);

  const fetchAiInbox = useCallback(async () => {
    setLoadingAiInbox(true);
    setAiInboxError(null);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      setAiConversations(await res.json());
    } catch {
      setAiInboxError("Não foi possível carregar as conversas recebidas pelo WhatsApp.");
      toast({ title: "Não foi possível carregar o atendimento por IA.", variant: "destructive" });
    } finally {
      setLoadingAiInbox(false);
    }
  }, [toast]);

  const selectAiConversation = useCallback(async (id: string) => {
    const requestId = ++aiConversationRequestId.current;
    setSelectedAiConversationId(id);
    setAiMessages([]);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${id}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const messages = await res.json() as AiMessage[];
      if (requestId === aiConversationRequestId.current) setAiMessages(messages);
    } catch {
      if (requestId === aiConversationRequestId.current) {
        toast({ title: "Não foi possível carregar o histórico.", variant: "destructive" });
      }
    }
  }, [toast]);

  useEffect(() => () => {
    aiConversationRequestId.current += 1;
  }, []);

  useEffect(() => {
    if (tab === "ai-inbox" || tab === "conversations") fetchAiInbox();
  }, [tab, fetchAiInbox]);

  useEffect(() => {
    const linkedConversations = aiConversations.filter((conversation) =>
      conversation.clientId === selectedConversationClientId
      && conversation.channel === "whatsapp",
    );
    if (tab !== "conversations" || !selectedConversationClientId || linkedConversations.length === 0) {
      setConversationAiMessages([]);
      setLoadingConversationAiMessages(false);
      setConversationAiError(null);
      return;
    }

    let cancelled = false;
    setConversationAiMessages([]);
    setLoadingConversationAiMessages(true);
    setConversationAiError(null);
    Promise.all(linkedConversations.map(async (conversation) => {
      const response = await fetch(
        `${BASE}/api/chatbot-conversations/${encodeURIComponent(conversation.id)}/messages`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("failed");
      return response.json() as Promise<AiConversationMessage[]>;
    }))
      .then((messagesByConversation) => {
        if (!cancelled) setConversationAiMessages(messagesByConversation.flat());
      })
      .catch(() => {
        if (!cancelled) {
          setConversationAiError("Não foi possível carregar as mensagens recebidas desta conversa.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConversationAiMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, selectedConversationClientId, aiConversations]);

  const handleResendFailed = async (emailLogId: string) => {
    setResendingId(emailLogId);
    try {
      const res = await fetch(`${BASE}/api/email-logs/${emailLogId}/resend`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "E-mail reenviado com sucesso.", description: "O alerta foi marcado como resolvido." });
        fetchFailedSummary();
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Erro ao reenviar", description: body.error ?? "Tente novamente.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro de conexão", description: "Não foi possível comunicar com o servidor. Verifique sua conexão e tente novamente.", variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  const messagesParams = { limit: 50 };
  const templatesQueryKey = getListMessageTemplatesQueryKey();
  const clientsParams = { limit: 500 };
  const messageClientsParams = {
    limit: 200,
    search: debouncedClientSearch || undefined,
    sortBy: "name",
    sortOrder: "asc",
  };
  const outboundHistoryParams = {
    limit: OUTBOUND_HISTORY_PAGE_SIZE,
    offset: historyOffset,
    status: historyStatus === "all" ? undefined : historyStatus,
    channel: historyChannel === "all" ? undefined : historyChannel,
    deliveryStatus: historyDeliveryStatus === "all" ? undefined : historyDeliveryStatus,
    bounceType: historyBounceType === "all" ? undefined : historyBounceType,
    provider: historyProvider === "all" ? undefined : historyProvider,
    origin: historyOrigin === "all" ? undefined : historyOrigin,
    clientId: historyClientId === "all" ? undefined : historyClientId,
    campaignId: historyCampaignId || undefined,
    automationId: historyAutomationId || undefined,
    dateFrom: historyDateFrom || undefined,
    dateTo: historyDateTo || undefined,
  };
  const conversationOutboundParams = { limit: 200 };
  const providerFailureParams = {
    status: historyStatus === "all" ? undefined : historyStatus,
    channel: historyChannel === "all" ? undefined : historyChannel,
    deliveryStatus: historyDeliveryStatus === "all" ? undefined : historyDeliveryStatus,
    bounceType: historyBounceType === "all" ? undefined : historyBounceType,
    provider: historyProvider === "all" ? undefined : historyProvider,
    origin: historyOrigin === "all" ? undefined : historyOrigin,
    clientId: historyClientId === "all" ? undefined : historyClientId,
    campaignId: historyCampaignId || undefined,
    automationId: historyAutomationId || undefined,
    dateFrom: historyDateFrom || undefined,
    dateTo: historyDateTo || undefined,
  };
  const { data: messages, isLoading: loadingMessages, isError: messagesError, error: messagesQueryError, refetch: refetchMessages } =
    useListMessages(messagesParams, {
      query: {
        queryKey: getListMessagesQueryKey(messagesParams),
        enabled: tab === "messages" || tab === "conversations",
      },
    });
  const { data: templates, isLoading: loadingTemplates, isError: templatesError, error: templatesQueryError, refetch: refetchTemplates } =
    useListMessageTemplates({
      query: { queryKey: templatesQueryKey, enabled: tab === "templates" || isSendOpen },
    });
  const { data: clients } = useListClients(clientsParams, {
    query: {
      queryKey: getListClientsQueryKey(clientsParams),
      enabled: tab === "email-logs",
    },
  });
  const { data: messageClients } = useListClients({
    ...messageClientsParams,
  }, {
    query: {
      queryKey: getListClientsQueryKey(messageClientsParams),
      enabled: isSendOpen,
    },
  });

  const sendMessage = useSendMessage();
  const createOutboundMessage = useCreateOutboundMessage();
  const retryOutboundDelivery = useRetryOutboundDelivery();
  const reconcileOutboundDelivery = useReconcileOutboundDelivery();
  const retryUnknownOutboundDelivery = useRetryUnknownOutboundDelivery();
  const {
    data: outboundMessages,
    isLoading: loadingOutboundMessages,
    isError: outboundMessagesError,
    error: outboundMessagesQueryError,
    refetch: refetchOutboundMessages,
    isFetching: isFetchingOutboundMessages,
    isPlaceholderData: isOutboundMessagesPlaceholder,
  } = useListOutboundMessages(outboundHistoryParams, {
    query: {
      queryKey: getListOutboundMessagesQueryKey(outboundHistoryParams),
      enabled: tab === "email-logs",
    },
  });
  const {
    data: conversationOutboundMessages,
    isLoading: loadingConversationOutboundMessages,
    isError: conversationOutboundMessagesError,
    refetch: refetchConversationOutboundMessages,
  } = useListOutboundMessages(conversationOutboundParams, {
    query: {
      queryKey: getListOutboundMessagesQueryKey(conversationOutboundParams),
      enabled: tab === "conversations",
    },
  });
  const {
    data: providerFailureSummary,
    isLoading: loadingProviderFailureSummary,
    isError: providerFailureSummaryError,
  } = useListOutboundProviderFailureSummary(providerFailureParams, {
    query: {
      queryKey: getListOutboundProviderFailureSummaryQueryKey(providerFailureParams),
      enabled: tab === "email-logs",
    },
  });

  useEffect(() => {
    if (!outboundMessages || isOutboundMessagesPlaceholder) return;
    setLoadedHistoryMessages((current) => {
      if (historyOffset === 0) return outboundMessages;
      const knownIds = new Set(current.map((message) => message.id));
      return [...current, ...outboundMessages.filter((message) => !knownIds.has(message.id))];
    });
    setHistoryHasMore(outboundMessages.length === OUTBOUND_HISTORY_PAGE_SIZE);
  }, [outboundMessages, historyOffset, isOutboundMessagesPlaceholder]);

  useEffect(() => {
    if (tab !== "email-logs") return;
    const stream = new EventSource(`${BASE}/api/outbound-messages/stream`, { withCredentials: true });
    const refreshHistory = (event: Event) => {
      resetHistoryPagination();
      void queryClient.invalidateQueries({ queryKey: ["/api/outbound-messages"] });
      const data = (event as MessageEvent<string>).data;
      if (!data) return;
      try {
        const payload = JSON.parse(data) as {
          status?: string;
          channel?: "email" | "whatsapp";
          provider?: string;
        };
        if (payload.status !== "failed") return;
        const channel = payload.channel === "email" ? "E-mail" : "WhatsApp";
        toast({
          title: "Falha de entrega confirmada",
          description: `${channel} rejeitado pelo provedor${payload.provider ? ` ${payload.provider}` : ""}. O histórico foi atualizado.`,
          variant: "destructive",
        });
      } catch {
        // The refresh above is still safe if a future event adds fields.
      }
    };
    stream.addEventListener("outbound-delivery-updated", refreshHistory);
    stream.onerror = () => {
      // EventSource retries by itself; each reconnect reuses the authenticated
      // URL and the next provider event invalidates the same query cache.
    };
    return () => {
      stream.removeEventListener("outbound-delivery-updated", refreshHistory);
      stream.close();
    };
  }, [queryClient, tab, toast]);
  const createTemplate = useCreateMessageTemplate();
  const updateTemplate = useUpdateMessageTemplate();
  const deleteTemplate = useDeleteMessageTemplate();

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { emailHtml, whatsappText } = prepareManualOutboundContent({
      emailContent,
      whatsappContent,
      clientName: selectedClientName,
    });
    await createOutboundMessage.mutateAsync({
      data: {
        eventType: "manual_message",
        idempotencyKey: `manual:${crypto.randomUUID()}`,
        recipient: { type: "client", id: selectedClientId },
        ...(sendChannel === "email"
          ? {
              email: {
                subject: resolveClientTemplate(emailSubject.trim() || "Mensagem da agência", selectedClientName),
                html: emailHtml,
              },
            }
          : { whatsapp: { text: whatsappText } }),
        origin: "user",
        originChannel: sendChannel,
      },
    });
    setIsSendOpen(false);
    setSelectedClientId("");
    setSelectedClientName("");
    setSendChannel("whatsapp");
    setClientSearch("");
    setDebouncedClientSearch("");
    setEmailContent("");
    setWhatsappContent("");
    setEmailSubject("Mensagem da agência");
    toast({
      title: "Mensagem criada",
      description: `A entrega por ${sendChannel === "email" ? "E-mail" : "WhatsApp"} foi programada.`,
    });
    refreshOutboundHistory();
    void refetchConversationOutboundMessages();
    refetchMessages();
  };

  const handleCreateTemplate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const content = String(fd.get("content") ?? "");
    const variables = extractTemplateVariables(content);
    if (editingTemplate) {
      await updateTemplate.mutateAsync({
        id: editingTemplate.id,
        data: {
          name: fd.get("name") as string,
          subject: (fd.get("subject") as string) || null,
          content,
          category: (fd.get("category") as string) || null,
        },
      });
    } else {
      await createTemplate.mutateAsync({
        data: {
          name: fd.get("name") as string,
          channel: tplChannel as "email" | "whatsapp",
          subject: (fd.get("subject") as string) || undefined,
          content,
          category: (fd.get("category") as string) || undefined,
          variables,
        },
      });
    }
    setIsTemplateOpen(false);
    setEditingTemplate(null);
    setTplChannel("whatsapp");
    refetchTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteTemplate.mutateAsync({ id });
    refetchTemplates();
  };

  const openEdit = (t: MessageTemplate) => {
    setEditingTemplate(t);
    setTplChannel(t.channel);
    setIsTemplateOpen(true);
  };

  const selectedClient = [...(messageClients?.data ?? []), ...(clients?.data ?? [])]
    .find((client) => client.id === selectedClientId);
  const uniqueHistoryOrigins = useMemo(
    () => Array.from(new Set(loadedHistoryMessages.map((message) => message.origin))).sort(),
    [loadedHistoryMessages],
  );
  const uniqueHistoryProviders = useMemo(
    () => Array.from(new Set([
      ...loadedHistoryMessages.flatMap((message) => message.deliveries.map((delivery) => delivery.provider).filter((provider): provider is string => Boolean(provider))),
      ...(providerFailureSummary ?? []).map((item) => item.provider).filter((provider): provider is string => Boolean(provider)),
    ])).sort(),
    [loadedHistoryMessages, providerFailureSummary],
  );
  const hasUnknownHistoryProvider = useMemo(
    () => (providerFailureSummary ?? []).some((item) => item.provider === null),
    [providerFailureSummary],
  );
  const filteredOutboundMessages = useMemo(() => {
    return loadedHistoryMessages.flatMap((message) => {
      if (historyStatus !== "all" && message.status !== historyStatus) return [];
      if (historyOrigin !== "all" && message.origin !== historyOrigin) return [];
      if (historyClientId !== "all" && message.recipientId !== historyClientId) return [];
      const deliveries = message.deliveries.filter((delivery) => (
        (historyChannel === "all" || delivery.channel === historyChannel) &&
        (historyDeliveryStatus === "all" || delivery.status === historyDeliveryStatus) &&
        (historyBounceType === "all" || delivery.bounceType === historyBounceType) &&
        (historyProvider === "all" ||
          (historyProvider === UNKNOWN_PROVIDER_FILTER
            ? delivery.provider === null
            : delivery.provider === historyProvider))
      ));
      if (deliveries.length === 0) return [];
      return [{ ...message, deliveries }];
    });
  }, [loadedHistoryMessages, historyStatus, historyDeliveryStatus, historyBounceType, historyProvider, historyOrigin, historyClientId, historyDateFrom, historyDateTo, historyChannel]);
  const failedDeliveryCount = useMemo(
    () => filteredOutboundMessages.reduce(
      (count, message) => count + message.deliveries.filter((delivery) => delivery.status === "failed").length,
      0,
    ),
    [filteredOutboundMessages],
  );
  const openProviderFailures = (provider: string | null) => {
    updateHistoryFilter(setHistoryProvider, provider ?? UNKNOWN_PROVIDER_FILTER);
    updateHistoryFilter(setHistoryDeliveryStatus, "failed");
    setExpandedHistoryId(null);
  };
  const handleHistoryFilterChange = (key: keyof CommunicationHistoryFilters, value: string) => {
    switch (key) {
      case "dateFrom": updateHistoryFilter(setHistoryDateFrom, value); break;
      case "dateTo": updateHistoryFilter(setHistoryDateTo, value); break;
      case "clientId": updateHistoryFilter(setHistoryClientId, value); break;
      case "channel": updateHistoryFilter(setHistoryChannel, value as "all" | "email" | "whatsapp"); break;
      case "deliveryStatus": updateHistoryFilter(setHistoryDeliveryStatus, value as OutboundDeliveryFilterStatus); break;
      case "bounceType": updateHistoryFilter(setHistoryBounceType, value as BounceTypeFilter); break;
      case "provider": updateHistoryFilter(setHistoryProvider, value); break;
      case "status": updateHistoryFilter(setHistoryStatus, value); break;
      case "origin": updateHistoryFilter(setHistoryOrigin, value); break;
      case "campaignId": updateHistoryFilter(setHistoryCampaignId, value); break;
      case "automationId": updateHistoryFilter(setHistoryAutomationId, value); break;
    }
  };
  const bounceTypeCounts = useMemo(() => ({
    permanent: filteredOutboundMessages.reduce((count, message) => count + message.deliveries.filter((delivery) => delivery.bounceType === "permanent").length, 0),
    temporary: filteredOutboundMessages.reduce((count, message) => count + message.deliveries.filter((delivery) => delivery.bounceType === "temporary").length, 0),
  }), [filteredOutboundMessages]);
  const openBounceType = (bounceType: Exclude<BounceTypeFilter, "all">) => {
    updateHistoryFilter(setHistoryBounceType, bounceType);
    setExpandedHistoryId(null);
  };
  const refreshOutboundHistory = () => {
    resetHistoryPagination();
    void queryClient.invalidateQueries({ queryKey: ["/api/outbound-messages"] });
  };

  const exportOutboundHistory = async (format: "csv" | "pdf") => {
    setHistoryExporting(format);
    try {
      const params = new URLSearchParams({ format });
      if (historyStatus !== "all") params.set("status", historyStatus);
      if (historyDeliveryStatus !== "all") params.set("deliveryStatus", historyDeliveryStatus);
      if (historyBounceType !== "all") params.set("bounceType", historyBounceType);
      if (historyProvider !== "all") params.set("provider", historyProvider);
      if (historyOrigin !== "all") params.set("origin", historyOrigin);
      if (historyClientId !== "all") params.set("clientId", historyClientId);
      if (historyChannel !== "all") params.set("channel", historyChannel);
      if (historyDateFrom) params.set("dateFrom", historyDateFrom);
      if (historyDateTo) params.set("dateTo", historyDateTo);
      if (historyCampaignId.trim()) params.set("campaignId", historyCampaignId.trim());
      if (historyAutomationId.trim()) params.set("automationId", historyAutomationId.trim());

      const response = await fetch(`${BASE}/api/outbound-messages/export?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Não foi possível exportar o histórico.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `historico_multicanal.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: `Histórico exportado em ${format.toUpperCase()}.` });
    } catch (error) {
      toast({
        title: "Erro na exportação",
        description: error instanceof Error ? error.message : "Não foi possível gerar o arquivo.",
        variant: "destructive",
      });
    } finally {
      setHistoryExporting(null);
    }
  };

  const handleRetryDelivery = async (delivery: OutboundDelivery) => {
    try {
      await retryOutboundDelivery.mutateAsync({ deliveryId: delivery.id });
      toast({ title: `${delivery.channel === "email" ? "E-mail" : "WhatsApp"} reenfileirado`, description: "Somente esta entrega será tentada novamente." });
      refetchOutboundMessages();
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast({
        title: "Não foi possível reenviar",
        description: message === "delivery_not_authorized"
          ? "Esta entrega foi ignorada por opt-out, contato ausente ou número inválido. Corrija a autorização/contato antes de enviar."
          : "Verifique a integração responsável e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const getMutationErrorMessage = (error: unknown, fallback: string) => {
    const apiError = error as { response?: { data?: { error?: string } } };
    return apiError.response?.data?.error ?? (error instanceof Error ? error.message : fallback);
  };

  const openReconciliation = (delivery: OutboundDelivery) => {
    setReconciliationDelivery(delivery);
    setReconciliationResult(null);
    setReconciliationError(null);
  };

  const closeReconciliation = () => {
    if (reconcileOutboundDelivery.isPending || retryUnknownOutboundDelivery.isPending) return;
    setReconciliationDelivery(null);
    setReconciliationResult(null);
    setReconciliationError(null);
  };

  const handleReconciliation = async () => {
    if (!reconciliationDelivery) return;
    setReconciliationError(null);
    setReconciliationResult(null);
    try {
      const result = await reconcileOutboundDelivery.mutateAsync({ deliveryId: reconciliationDelivery.id });
      setReconciliationResult(result);
      await refetchOutboundMessages();
    } catch (error) {
      setReconciliationError(getMutationErrorMessage(error, "Não foi possível consultar o provedor."));
      await refetchOutboundMessages();
    }
  };

  const handleRetryAfterReconciliation = async () => {
    if (!reconciliationDelivery) return;
    setReconciliationError(null);
    try {
      await retryUnknownOutboundDelivery.mutateAsync({ deliveryId: reconciliationDelivery.id });
      toast({
        title: "Entrega reenfileirada",
        description: "O provedor confirmou que a mensagem não foi encontrada. Uma nova tentativa foi registrada.",
      });
      await refetchOutboundMessages();
      closeReconciliation();
    } catch (error) {
      setReconciliationError(getMutationErrorMessage(error, "O reenvio continua bloqueado até uma confirmação segura."));
      await refetchOutboundMessages();
    }
  };

  const filteredMessages =
    filterChannel === "all"
      ? (messages ?? [])
      : (messages ?? []).filter((m) => m.channel === filterChannel);

  const conversations = useMemo(
    () => buildClientConversationSummaries({
      messages: messages ?? [],
      outboundMessages: conversationOutboundMessages ?? [],
      chatbotConversations: aiConversations,
    }),
    [messages, conversationOutboundMessages, aiConversations],
  );

  const conversationMessages = useMemo(
    () => buildClientTimeline({
      clientId: selectedConversationClientId,
      messages: messages ?? [],
      outboundMessages: conversationOutboundMessages ?? [],
      chatbotConversations: aiConversations,
      chatbotMessages: conversationAiMessages,
    }),
    [
      selectedConversationClientId,
      messages,
      conversationOutboundMessages,
      aiConversations,
      conversationAiMessages,
    ],
  );

  const selectedWhatsAppConversation = useMemo(
    () => aiConversations
      .filter((conversation) =>
        conversation.clientId === selectedConversationClientId && conversation.channel === "whatsapp",
      )
      .sort((left, right) =>
        Date.parse(right.lastMessageAt ?? right.createdAt) - Date.parse(left.lastMessageAt ?? left.createdAt),
      )[0] ?? null,
    [aiConversations, selectedConversationClientId],
  );

  const handleSendInbox = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedConversationClientId || !inboxMessage.trim()) return;
    if (inboxChannel === "whatsapp" && selectedWhatsAppConversation?.status === "opted_out") {
      toast({
        title: "WhatsApp indisponível para esta conversa",
        description: "O contato pediu para não receber novas mensagens por este canal.",
        variant: "destructive",
      });
      return;
    }
    try {
      await sendMessage.mutateAsync({
        data: {
          toClientId: selectedConversationClientId,
          channel: inboxChannel,
          content: inboxMessage,
        },
      });
      setInboxMessage("");
      await Promise.all([refetchMessages(), refetchConversationOutboundMessages()]);
    } catch (error) {
      toast({
        title: "Não foi possível enviar a mensagem.",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleAiReply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedAiConversationId || !aiReply.trim()) return;
    setSendingAiReply(true);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${selectedAiConversationId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: aiReply.trim(),
          idempotencyKey: aiReplyKey.current ?? (aiReplyKey.current = crypto.randomUUID()),
        }),
      });
      if (!res.ok) throw new Error("failed");
      setAiReply("");
      aiReplyKey.current = null;
      await Promise.all([selectAiConversation(selectedAiConversationId), fetchAiInbox()]);
    } catch {
      toast({ title: "Não foi possível enviar pelo WhatsApp.", variant: "destructive" });
    } finally {
      setSendingAiReply(false);
    }
  };

  const handleAssociateAiClient = async (clientId: string) => {
    const conversationId = selectedAiConversationId;
    if (!conversationId) return;
    setAssociatingAiConversationId(conversationId);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${conversationId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId === NO_ASSOCIATED_CLIENT ? null : clientId,
        }),
      });
      if (!res.ok) throw new Error("failed");
      await fetchAiInbox();
      toast({ title: "Vínculo do atendimento atualizado." });
    } catch {
      toast({ title: "Não foi possível associar o atendimento ao cliente.", variant: "destructive" });
    } finally {
      setAssociatingAiConversationId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comunicação"
        description="Envie mensagens e gerencie templates omnicanal."
        actions={
          <>
            {canManageTemplates && (
              <Dialog
                open={isTemplateOpen}
                onOpenChange={(o) => {
                  setIsTemplateOpen(o);
                  if (!o) setEditingTemplate(null);
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="w-4 h-4 mr-2" /> Novo Template
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>
                      {editingTemplate ? "Editar Template" : "Criar Template"}
                    </DialogTitle>
                  </DialogHeader>
                  <form
                    key={editingTemplate?.id ?? "new"}
                    onSubmit={handleCreateTemplate}
                    className="space-y-4 mt-4"
                  >
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Nome do Template</label>
                      <Input
                        name="name"
                        required
                        placeholder="Ex: Confirmação de Reserva"
                        defaultValue={editingTemplate?.name ?? ""}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Canal</label>
                        <Select
                          value={tplChannel}
                          onValueChange={setTplChannel}
                          disabled={!!editingTemplate}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {editingTemplate && !OUTBOUND_CHANNELS.some((channel) => channel.value === tplChannel) && (
                              <SelectItem value={tplChannel}>{CHANNELS.find((channel) => channel.value === tplChannel)?.label ?? tplChannel}</SelectItem>
                            )}
                            {OUTBOUND_CHANNELS.map((ch) => (
                              <SelectItem key={ch.value} value={ch.value}>
                                {ch.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Categoria</label>
                        <Input
                          name="category"
                          placeholder="Ex: confirmacao"
                          defaultValue={editingTemplate?.category ?? ""}
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border bg-blue-50/60 p-3 text-xs text-blue-900">
                      Templates são específicos por canal. Para uma mensagem sincronizada, crie/edite um template de E-mail e outro de WhatsApp com o mesmo nome e selecione o conteúdo correspondente no composer.
                    </div>
                    {tplChannel === "email" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Assunto</label>
                        <Input
                          name="subject"
                          placeholder="Assunto do e-mail"
                          defaultValue={editingTemplate?.subject ?? ""}
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Conteúdo</label>
                      <Textarea
                        name="content"
                        required
                        rows={5}
                        placeholder="Olá {nome}, temos uma atualização para você."
                        defaultValue={editingTemplate?.content ?? ""}
                      />
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <WholeWord className="w-3.5 h-3.5" />
                        {"{nome}"} será substituído pelo nome do cliente selecionado.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setIsTemplateOpen(false);
                          setEditingTemplate(null);
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="submit"
                        disabled={createTemplate.isPending || updateTemplate.isPending}
                      >
                        {createTemplate.isPending || updateTemplate.isPending
                          ? "Salvando..."
                          : editingTemplate
                            ? "Salvar Alterações"
                            : "Criar Template"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}

          <Dialog open={isSendOpen} onOpenChange={setIsSendOpen}>
            <DialogTrigger asChild>
              <Button>
                <Send className="w-4 h-4 mr-2" /> Enviar Mensagem
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Enviar Mensagem</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSend} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cliente</label>
                  <Input
                    value={clientSearch}
                    onChange={(event) => setClientSearch(event.target.value)}
                    placeholder="Buscar pelo nome do cliente..."
                    aria-label="Buscar cliente para a mensagem"
                  />
                  <Select
                    value={selectedClientId}
                    onValueChange={(id) => {
                      setSelectedClientId(id);
                      const client = [...(messageClients?.data ?? []), ...(clients?.data ?? [])]
                        .find((candidate) => candidate.id === id);
                      setSelectedClientName(client?.name ?? "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {messageClients?.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Iniciar por</label>
                  <Select
                    value={sendChannel}
                    onValueChange={(value) => setSendChannel(value as "email" | "whatsapp")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTBOUND_CHANNELS.map((ch) => (
                        <SelectItem key={ch.value} value={ch.value}>
                          {ch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    E-mail e WhatsApp são entregas da mesma mensagem. Escolha apenas qual canal deve iniciar o fluxo.
                  </p>
                </div>
                {selectedClient && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                    <p className="font-medium">Disponibilidade de contato</p>
                    <p className={selectedClient.email ? "text-foreground" : "text-amber-700"}>
                      E-mail: {selectedClient.email ? "disponível" : "ausente"}{selectedClient.emailOptIn === false ? " · opt-out" : ""}
                    </p>
                    <p className={selectedClient.whatsapp ? "text-foreground" : "text-amber-700"}>
                      WhatsApp: {selectedClient.whatsapp ? "disponível" : "ausente"}{selectedClient.whatsappOptIn === false ? " · opt-out" : ""}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template (opcional)</label>
                  <Select
                    onValueChange={(id) => {
                      const tpl = (templates ?? []).find((x) => x.id === id);
                      if (tpl?.channel === "email") {
                        setEmailContent(tpl.content);
                        if (tpl.subject) setEmailSubject(tpl.subject);
                      } else if (tpl) {
                        setWhatsappContent(tpl.content);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(templates ?? [])
                        .filter((t) => t.channel === sendChannel)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Conteúdo do E-mail</label>
                    <Input
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Assunto do e-mail"
                      aria-label="Assunto do e-mail"
                      required={Boolean(emailContent.trim())}
                    />
                    <Textarea
                      rows={5}
                      placeholder="HTML ou texto do e-mail..."
                      value={emailContent}
                      onChange={(e) => setEmailContent(e.target.value)}
                      aria-label="Conteúdo do e-mail"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Conteúdo do WhatsApp</label>
                    <Textarea
                      rows={7}
                      placeholder="Texto do WhatsApp..."
                      value={whatsappContent}
                      onChange={(e) => setWhatsappContent(e.target.value)}
                      aria-label="Conteúdo do WhatsApp"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada canal usa seu próprio conteúdo. Se um campo ficar vazio, somente essa entrega será ignorada.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSendOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={createOutboundMessage.isPending || !selectedClientId || (!emailContent.trim() && !whatsappContent.trim())}
                  >
                      {createOutboundMessage.isPending ? "Programando..." : "Programar mensagem"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <Dialog open={Boolean(reconciliationDelivery)} onOpenChange={(open) => { if (!open) closeReconciliation(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Revisar resultado desconhecido</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  O provedor pode ter aceitado esta mensagem mesmo sem responder. O sistema não enviará novamente
                  enquanto não houver uma confirmação segura.
                </p>
              </div>
            </div>
            {reconciliationDelivery && (
              <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-1">
                <p><strong>Canal:</strong> WhatsApp · <strong>Provedor:</strong> {reconciliationDelivery.provider ?? "não identificado"}</p>
                <p><strong>Destinatário:</strong> {reconciliationDelivery.recipient ?? "sem contato"}</p>
                <p><strong>ID externo:</strong> {reconciliationDelivery.externalId ?? "não disponível"}</p>
                <p><strong>Tentativa original:</strong> {reconciliationDelivery.attempts}</p>
              </div>
            )}
            {reconciliationError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {reconciliationError}
              </div>
            )}
            {reconciliationResult && (
              <div className={`rounded-lg border p-3 text-sm ${
                reconciliationResult.outcome === "accepted"
                  ? "border-green-200 bg-green-50 text-green-900"
                  : reconciliationResult.outcome === "not_found"
                    ? "border-amber-200 bg-amber-50 text-amber-950"
                    : "border-slate-200 bg-slate-50 text-slate-900"
              }`}>
                <p className="font-medium">
                  {reconciliationResult.outcome === "accepted"
                    ? "O provedor confirmou que a mensagem foi aceita."
                    : reconciliationResult.outcome === "not_found"
                      ? "O provedor não encontrou a mensagem."
                      : reconciliationResult.outcome === "unsupported"
                        ? "Este provedor não permite consulta por ID."
                        : "A consulta não foi conclusiva."}
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {reconciliationResult.providerStatus
                    ? `Status retornado: ${reconciliationResult.providerStatus}.`
                    : reconciliationResult.detail ?? "Nenhum detalhe adicional foi retornado."}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeReconciliation} disabled={reconcileOutboundDelivery.isPending || retryUnknownOutboundDelivery.isPending}>
                Fechar
              </Button>
              {!reconciliationResult && (
                <Button type="button" onClick={() => { void handleReconciliation(); }} disabled={reconcileOutboundDelivery.isPending}>
                  {reconcileOutboundDelivery.isPending ? "Consultando provedor..." : "Consultar provedor"}
                </Button>
              )}
              {reconciliationResult?.canRetry && (
                <Button type="button" variant="destructive" onClick={() => { void handleRetryAfterReconciliation(); }} disabled={retryUnknownOutboundDelivery.isPending}>
                  {retryUnknownOutboundDelivery.isPending ? "Confirmando..." : "Confirmar e reenviar"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="conversations">Mensagens por cliente</TabsTrigger>
          <TabsTrigger value="ai-inbox" className="flex items-center gap-1">
            <MessageSquare className="w-3.5 h-3.5" /> Atendimento IA
          </TabsTrigger>
          <TabsTrigger value="messages">Mensagens Enviadas</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="email-logs" className="flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> Histórico Multicanal
          </TabsTrigger>
          {canReviewFailedEmails && <TabsTrigger value="failed-emails" className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            E-mails Falhos
            {failedSummary.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold w-5 h-5">
                {failedSummary.length}
              </span>
            )}
          </TabsTrigger>}
        </TabsList>

        <TabsContent value="conversations" className="mt-4">
          <ConversationsTab
            channelColors={channelColors}
            channelLabels={channelLabels}
            summaries={conversations}
            selectedClientId={selectedConversationClientId}
            onSelectClient={setSelectedConversationClientId}
            loadingMessages={loadingMessages}
            loadingOutboundMessages={loadingConversationOutboundMessages}
            loadingAiInbox={loadingAiInbox}
            messagesError={messagesError}
            messagesQueryError={messagesQueryError}
            outboundMessagesError={conversationOutboundMessagesError}
            aiInboxError={aiInboxError}
            refetchMessages={refetchMessages}
            refetchOutboundMessages={refetchConversationOutboundMessages}
            fetchAiInbox={fetchAiInbox}
            conversationMessages={conversationMessages}
            selectedClientName={conversations.find((item) => item.clientId === selectedConversationClientId)?.clientName}
            loadingConversationAiMessages={loadingConversationAiMessages}
            conversationAiError={conversationAiError}
            selectedWhatsAppConversation={selectedWhatsAppConversation}
            inboxChannel={inboxChannel}
            setInboxChannel={setInboxChannel}
            inboxMessage={inboxMessage}
            setInboxMessage={setInboxMessage}
            handleSendInbox={handleSendInbox}
            sendingMessage={sendMessage.isPending}
          />
        </TabsContent>

        <TabsContent value="ai-inbox" className="mt-4">
          {loadingAiInbox ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              <div className="col-span-2"><Skeleton className="h-[400px] w-full" /></div>
            </div>
          ) : aiInboxError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
              <p>{aiInboxError}</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => { void fetchAiInbox(); }}>
                Tentar novamente
              </Button>
            </div>
          ) : aiConversations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Nenhum atendimento WhatsApp ainda.</p>
              <p className="text-sm mt-1">As conversas recebidas pela integração aparecerão aqui.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[520px]">
              <div className="border rounded-lg overflow-hidden flex flex-col">
                <div className="p-3 border-b bg-muted/30">
                  <p className="text-sm font-semibold">Atendimentos ({aiConversations.length})</p>
                </div>
                <div className="flex-1 overflow-y-auto divide-y">
                  {aiConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => selectAiConversation(conversation.id)}
                      className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${selectedAiConversationId === conversation.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}
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
                {!selectedAiConversationId ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <p className="text-sm">Selecione um atendimento para ver o histórico.</p>
                  </div>
                ) : (
                  <>
                    <div className="p-3 border-b bg-muted/30 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">Atendimento WhatsApp</p>
                        <p className="text-xs text-muted-foreground">A IA interrompe respostas ao detectar uma solicitação de atendimento humano.</p>
                      </div>
                      <Select
                        value={aiConversations.find((conversation) => conversation.id === selectedAiConversationId)?.clientId ?? NO_ASSOCIATED_CLIENT}
                        onValueChange={handleAssociateAiClient}
                        disabled={associatingAiConversationId === selectedAiConversationId}
                      >
                        <SelectTrigger aria-label="Associar atendimento a cliente" className="w-full sm:w-64">
                          <SelectValue placeholder="Associar cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ASSOCIATED_CLIENT}>Sem cliente associado</SelectItem>
                          {(clients?.data ?? []).map((client) => (
                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {aiMessages.map((message) => (
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
                      <form onSubmit={handleAiReply} className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Responder como equipe..."
                          value={aiReply}
                          onChange={(e) => setAiReply(e.target.value)}
                        />
                        <Button type="submit" size="sm" disabled={sendingAiReply || !aiReply.trim()}>
                          <Send className="w-4 h-4" />
                        </Button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <MessagesTab
            filterChannel={filterChannel}
            onFilterChange={setFilterChannel}
            messages={messages ?? []}
            loading={loadingMessages}
            error={messagesError}
            queryError={messagesQueryError}
            onRetry={refetchMessages}
            channelColors={channelColors}
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <TemplatesTab
            templates={templates}
            loading={loadingTemplates}
            error={templatesError}
            queryError={templatesQueryError}
            onRetry={refetchTemplates}
            canManageTemplates={canManageTemplates}
            channelColors={channelColors}
            onEdit={openEdit}
            onDelete={handleDeleteTemplate}
            extractTemplateVariables={extractTemplateVariables}
          />
        </TabsContent>

        <TabsContent value="email-logs" className="mt-4">
          <CommunicationHistoryTab
            filters={{
              dateFrom: historyDateFrom,
              dateTo: historyDateTo,
              clientId: historyClientId,
              channel: historyChannel,
              deliveryStatus: historyDeliveryStatus,
              bounceType: historyBounceType,
              provider: historyProvider,
              status: historyStatus,
              origin: historyOrigin,
              campaignId: historyCampaignId,
              automationId: historyAutomationId,
            }}
            onFilterChange={handleHistoryFilterChange}
            onClearFilters={() => {
              setHistoryDateFrom("");
              setHistoryDateTo("");
              setHistoryClientId("all");
              setHistoryChannel("all");
              setHistoryStatus("all");
              setHistoryDeliveryStatus("all");
              setHistoryBounceType("all");
              setHistoryProvider("all");
              setHistoryOrigin("all");
              setHistoryCampaignId("");
              setHistoryAutomationId("");
              resetHistoryPagination();
            }}
            clients={clients?.data ?? []}
            origins={uniqueHistoryOrigins}
            providers={uniqueHistoryProviders}
            hasUnknownProvider={hasUnknownHistoryProvider}
            unknownProviderValue={UNKNOWN_PROVIDER_FILTER}
            messages={filteredOutboundMessages}
            loading={loadingOutboundMessages}
            fetching={isFetchingOutboundMessages}
            error={outboundMessagesError}
            errorDetail={outboundMessagesQueryError}
            hasMore={historyHasMore}
            onRetry={refetchOutboundMessages}
            onLoadMore={() => setHistoryOffset(loadedHistoryMessages.length)}
            onRefresh={refreshOutboundHistory}
            exporting={historyExporting}
            onExport={(format) => { void exportOutboundHistory(format); }}
            expandedMessageId={expandedHistoryId}
            onToggleMessage={(id) => setExpandedHistoryId(expandedHistoryId === id ? null : id)}
            canManageTemplates={canManageTemplates}
            onReconcile={openReconciliation}
            onRetryDelivery={handleRetryDelivery}
            retryingDelivery={retryOutboundDelivery.isPending}
            failedDeliveryCount={failedDeliveryCount}
            bounceCounts={bounceTypeCounts}
            onOpenProviderFailures={openProviderFailures}
            onOpenBounceType={openBounceType}
            providerFailureSummary={providerFailureSummary}
            loadingProviderFailureSummary={loadingProviderFailureSummary}
            providerFailureSummaryError={providerFailureSummaryError}
            channelColors={channelColors}
            outboundStatusLabels={outboundStatusLabels}
            deliveryStatusLabels={outboundDeliveryStatusLabels}
            bounceTypeLabels={bounceTypeLabels}
          />
        </TabsContent>

        <TabsContent value="failed-emails" className="mt-4">
          <FailedEmailsTab
            failedSummary={failedSummary}
            loading={loadingFailedSummary}
            error={failedSummaryError}
            resendingId={resendingId}
            onRefresh={fetchFailedSummary}
            onResend={handleResendFailed}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
