import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
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
  useGetMessageClientStatus,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  TicketCheck,
  ChevronsUpDown,
  MapPin,
  Search,
  ExternalLink,
  ArrowLeft,
  MessageCircle,
  Mail as MailIcon,
  Instagram,
  Phone,
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
} from "@/lib/communicationTimeline";
import {
  ConversationsTab,
  MessageMediaAttachment,
  type ClientLinkStatus,
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
import { useConversationAiMessages } from "./communication/useConversationAiMessages";
import { submitInboxMessage } from "./communication/submitInboxMessage";
import {
  filterAiInboxConversations,
  getAiInboxStatusCounts,
  type AiInboxChannelFilter,
  type AiInboxStatusFilter,
} from "./communication/aiInboxFilters";
import {
  getAiInboxChannelIdentifier,
  getAiInboxDisplayName,
  getAiInboxInitials,
} from "./communication/aiInboxContactInfo";
import {
  getInstagramIdentity,
  getInstagramProfileUrl,
  getWhatsAppDirectUrl,
  getInstagramReplyByteCount,
  INSTAGRAM_REPLY_MAX_BYTES,
  isInstagramReplyWindowExpired,
} from "./communication/instagramInboxRules";
import {
  getAiReplyAttempt,
  shouldRetainAiReplyAttempt,
} from "./communication/aiReplyRetryPolicy";
import SupportTicketsTab from "./communication/SupportTicketsTab";

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
  const [selectedClientSnapshot, setSelectedClientSnapshot] = useState<{
    email: string | null;
    emailOptIn: boolean | null;
    whatsapp: string | null;
    whatsappOptIn: boolean | null;
  } | null>(null);
  const [sendClientPickerOpen, setSendClientPickerOpen] = useState(false);
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
  const [aiInboxChannelFilter, setAiInboxChannelFilter] = useState<AiInboxChannelFilter>("all");
  const [aiInboxStatusFilter, setAiInboxStatusFilter] = useState<AiInboxStatusFilter>("all");
  const [aiInboxSearch, setAiInboxSearch] = useState("");
  const [selectedAiConversationId, setSelectedAiConversationId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiTimelineCursor, setAiTimelineCursor] = useState<string | null>(null);
  const [aiTimelineHasMore, setAiTimelineHasMore] = useState(false);
  const [loadingOlderAiMessages, setLoadingOlderAiMessages] = useState(false);
  const [loadingAiMessages, setLoadingAiMessages] = useState(false);
  const [aiMessagesError, setAiMessagesError] = useState<string | null>(null);
  const {
    messages: conversationAiMessages,
    loading: loadingConversationAiMessages,
    retryingConversationIds: retryingConversationAiIds,
    queuedRetryConversationIds,
    error: conversationAiError,
    failedConversationLabels: conversationAiFailureLabels,
    retryConversationAiMessages,
  } = useConversationAiMessages({
    enabled: tab === "conversations",
    selectedClientId: selectedConversationClientId,
    conversations: aiConversations,
  });
  const [aiInboxError, setAiInboxError] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState("");
  const aiInboxStatusCounts = useMemo(
    () => getAiInboxStatusCounts(aiConversations, aiInboxChannelFilter),
    [aiConversations, aiInboxChannelFilter],
  );
  const visibleAiConversations = useMemo(
    () =>
      filterAiInboxConversations(
        aiConversations,
        {
          channel: aiInboxChannelFilter,
          status: aiInboxStatusFilter,
          search: aiInboxSearch,
        },
        getInstagramIdentity,
      ),
    [aiConversations, aiInboxChannelFilter, aiInboxStatusFilter, aiInboxSearch],
  );
  const selectedAiConversation = aiConversations.find(
    (conversation) => conversation.id === selectedAiConversationId,
  );
  const instagramReplyWindowExpired = selectedAiConversation?.channel === "instagram"
    && isInstagramReplyWindowExpired(aiMessages);
  const instagramReplyTooLong = selectedAiConversation?.channel === "instagram"
    && getInstagramReplyByteCount(aiReply) > INSTAGRAM_REPLY_MAX_BYTES;
  const [loadingAiInbox, setLoadingAiInbox] = useState(false);
  const [sendingAiReply, setSendingAiReply] = useState(false);
  const [associatingAiConversationId, setAssociatingAiConversationId] = useState<string | null>(null);
  const [aiClientPickerOpen, setAiClientPickerOpen] = useState(false);
  const aiReplyKeys = useRef(new Map<string, { conversationId: string; content: string; idempotencyKey: string }>());
  const aiConversationRequestId = useRef(0);
  const aiInboxRequestId = useRef(0);
  const aiMessagesScrollRef = useRef<HTMLDivElement>(null);
  const pendingTimelinePrependScroll = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = aiMessagesScrollRef.current;
    const pending = pendingTimelinePrependScroll.current;
    if (!element) return;
    if (pending) {
      element.scrollTop = pending.top + (element.scrollHeight - pending.height);
      pendingTimelinePrependScroll.current = null;
    } else if (!loadingAiMessages) {
      element.scrollTop = element.scrollHeight;
    }
  }, [aiMessages, loadingAiMessages]);

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

  const fetchAiInbox = useCallback(async (silent = false) => {
    const requestId = ++aiInboxRequestId.current;
    if (!silent) {
      setLoadingAiInbox(true);
      setAiInboxError(null);
    }
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const conversations = await res.json();
      if (requestId !== aiInboxRequestId.current) return;
      setAiConversations(conversations);
      setAiInboxError(null);
    } catch {
      if (!silent && requestId === aiInboxRequestId.current) {
        setAiInboxError("Não foi possível carregar as conversas recebidas pelo WhatsApp e pelo Instagram.");
        toast({ title: "Não foi possível carregar o atendimento por IA.", variant: "destructive" });
      }
    } finally {
      if (requestId === aiInboxRequestId.current) setLoadingAiInbox(false);
    }
  }, [toast]);

  const selectAiConversation = useCallback(async (id: string, silent = false) => {
    const requestId = ++aiConversationRequestId.current;
    setLoadingOlderAiMessages(false);
    pendingTimelinePrependScroll.current = null;
    if (!silent) {
      setSelectedAiConversationId(id);
      setAiMessages([]);
      setAiTimelineCursor(null);
      setAiTimelineHasMore(false);
      setLoadingAiMessages(true);
      setAiMessagesError(null);
    }
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${id}/timeline?limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      const page = await res.json() as {
        items: AiMessage[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean") throw new Error("invalid timeline response");
      if (requestId === aiConversationRequestId.current) {
        setAiMessages(page.items);
        setAiTimelineCursor(page.nextCursor);
        setAiTimelineHasMore(page.hasMore);
        setAiMessagesError(null);
      }
    } catch {
      if (!silent && requestId === aiConversationRequestId.current) {
        setAiMessagesError("Não foi possível carregar o histórico desta conversa.");
        toast({ title: "Não foi possível carregar o histórico.", variant: "destructive" });
      }
    } finally {
      if (!silent && requestId === aiConversationRequestId.current) setLoadingAiMessages(false);
    }
  }, [toast]);

  const loadOlderAiMessages = useCallback(async () => {
    const conversationId = selectedAiConversationId;
    const cursor = aiTimelineCursor;
    if (!conversationId || !cursor || !aiTimelineHasMore || loadingOlderAiMessages) return;
    const requestId = aiConversationRequestId.current;
    setLoadingOlderAiMessages(true);
    try {
      const query = new URLSearchParams({ limit: "50", cursor });
      const res = await fetch(
        `${BASE}/api/chatbot-conversations/${conversationId}/timeline?${query.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      const page = await res.json() as {
        items: AiMessage[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean") throw new Error("invalid timeline response");
      if (
        requestId !== aiConversationRequestId.current ||
        conversationId !== selectedAiConversationId
      ) return;
      const element = aiMessagesScrollRef.current;
      if (element) {
        pendingTimelinePrependScroll.current = {
          height: element.scrollHeight,
          top: element.scrollTop,
        };
      }
      setAiMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        return [...page.items.filter((message) => !currentIds.has(message.id)), ...current];
      });
      setAiTimelineCursor(page.nextCursor);
      setAiTimelineHasMore(page.hasMore);
    } catch {
      if (requestId === aiConversationRequestId.current) {
        toast({
          title: "Não foi possível carregar mensagens anteriores.",
          description: "Tente novamente sem sair desta conversa.",
          variant: "destructive",
        });
      }
    } finally {
      if (requestId === aiConversationRequestId.current) setLoadingOlderAiMessages(false);
    }
  }, [selectedAiConversationId, aiTimelineCursor, aiTimelineHasMore, loadingOlderAiMessages, toast]);

  useEffect(() => () => {
    aiConversationRequestId.current += 1;
  }, []);

  useEffect(() => {
    if (tab !== "ai-inbox" && tab !== "conversations") return;
    void fetchAiInbox();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchAiInbox(true);
    }, 5_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchAiInbox(true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      aiInboxRequestId.current += 1;
    };
  }, [tab, fetchAiInbox]);

  useEffect(() => {
    if (tab !== "ai-inbox" || !selectedAiConversationId) return;
    const conversationId = selectedAiConversationId;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void selectAiConversation(conversationId, true);
      }
    };
    const interval = window.setInterval(() => {
      refreshWhenVisible();
    }, 3_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [tab, selectedAiConversationId, selectAiConversation]);

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
    limit: 50,
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
  const {
    data: selectedConversationClientStatus,
    isLoading: loadingSelectedConversationClientStatus,
    isFetching: fetchingSelectedConversationClientStatus,
    isError: selectedConversationClientStatusError,
    refetch: refetchSelectedConversationClientStatus,
  } = useGetMessageClientStatus(selectedConversationClientId ?? "", {
    query: {
      enabled: tab === "conversations" && Boolean(selectedConversationClientId),
      retry: false,
      staleTime: 0,
    },
  });
  const { data: templates, isLoading: loadingTemplates, isError: templatesError, error: templatesQueryError, refetch: refetchTemplates } =
    useListMessageTemplates({
      query: { queryKey: templatesQueryKey, enabled: tab === "templates" || isSendOpen },
    });
  const { data: clients } = useListClients(clientsParams, {
    query: {
      queryKey: getListClientsQueryKey(clientsParams),
      enabled: tab === "email-logs" || tab === "ai-inbox",
    },
  });
  const aiInboxClientsById = useMemo(
    () => new Map((clients?.data ?? []).map((client) => [client.id, client])),
    [clients?.data],
  );
  const selectedAiClient = (clients?.data ?? []).find(
    (client) => client.id === selectedAiConversation?.clientId,
  );
  const selectedInstagramProfileUrl = selectedAiConversation?.channel === "instagram"
    ? getInstagramProfileUrl(
      selectedAiConversation.metadata?.["instagramUsername"] ?? selectedAiClient?.instagram,
    )
    : null;
  const selectedWhatsAppUrl = selectedAiConversation?.status === "opted_out"
    ? null
    : selectedAiConversation?.channel === "whatsapp"
      ? getWhatsAppDirectUrl(selectedAiClient?.whatsapp || selectedAiClient?.phone || selectedAiConversation.sessionId)
      : getWhatsAppDirectUrl(selectedAiClient?.whatsapp || selectedAiClient?.phone);
  const selectedEmailUrl = selectedAiClient?.email
    ? `mailto:${encodeURIComponent(selectedAiClient.email)}`
    : null;
  const { data: messageClients, isLoading: loadingMessageClients } = useListClients({
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
        ...(emailHtml.trim()
          ? {
              email: {
                subject: resolveClientTemplate(emailSubject.trim() || "Mensagem da agência", selectedClientName),
                html: emailHtml,
              },
            }
          : {}),
        ...(whatsappText.trim() ? { whatsapp: { text: whatsappText } } : {}),
        origin: "user",
        originChannel: sendChannel,
      },
    });
    setIsSendOpen(false);
    setSelectedClientId("");
    setSelectedClientName("");
    setSelectedClientSnapshot(null);
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

  const selectedClient = selectedClientSnapshot ?? [...(messageClients?.data ?? []), ...(clients?.data ?? [])]
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

  const selectedClientLinkStatus: ClientLinkStatus = !selectedConversationClientId
    ? "valid"
    : fetchingSelectedConversationClientStatus || loadingSelectedConversationClientStatus
      ? "checking"
      : selectedConversationClientStatusError
        ? "unavailable"
        : selectedConversationClientStatus?.valid === true
          ? "valid"
          : selectedConversationClientStatus?.valid === false
            ? "missing"
            : "checking";

  const openSelectedConversationForReassociation = () => {
    if (!selectedWhatsAppConversation) return;
    setTab("ai-inbox");
    void selectAiConversation(selectedWhatsAppConversation.id);
  };

  const openFailedWhatsAppConversation = (conversationId: string) => {
    const failedConversation = aiConversations.find((conversation) => conversation.id === conversationId);
    if (
      !failedConversation ||
      failedConversation.clientId !== selectedConversationClientId ||
      failedConversation.channel !== "whatsapp"
    ) {
      return;
    }
    setTab("ai-inbox");
    void selectAiConversation(failedConversation.id);
  };

  const handleSendInbox = (e: React.FormEvent<HTMLFormElement>) =>
    submitInboxMessage({
      event: e,
      selectedClientId: selectedConversationClientId,
      message: inboxMessage,
      channel: inboxChannel,
      clientLinkStatus: selectedClientLinkStatus,
      whatsappOptedOut: selectedWhatsAppConversation?.status === "opted_out",
      sendMessage: (input) => sendMessage.mutateAsync(input),
      setInboxMessage,
      refetchMessages,
      refetchOutboundMessages: refetchConversationOutboundMessages,
      toast,
    });

  const handleAiReply = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedAiConversationId || !aiReply.trim()) return;
    const content = aiReply.trim();
    const conversationId = selectedAiConversationId;
    const attempt = getAiReplyAttempt(
      aiReplyKeys.current.get(conversationId) ?? null,
      conversationId,
      content,
      () => crypto.randomUUID(),
    );
    aiReplyKeys.current.set(conversationId, attempt);
    setSendingAiReply(true);
    let receivedResponse = false;
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${conversationId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          idempotencyKey: attempt.idempotencyKey,
        }),
      });
      receivedResponse = true;
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        const code = typeof responseBody["code"] === "string" ? responseBody["code"] : "";
        if (
          !shouldRetainAiReplyAttempt(res.status, code)
          && aiReplyKeys.current.get(conversationId)?.idempotencyKey === attempt.idempotencyKey
        ) {
          aiReplyKeys.current.delete(conversationId);
        }
        throw new Error(typeof responseBody["error"] === "string"
          ? responseBody["error"]
          : typeof responseBody["message"] === "string"
            ? responseBody["message"]
            : "Não foi possível confirmar o envio.");
      }
      const deliveryQueued = res.status === 202;
      setAiReply("");
      if (aiReplyKeys.current.get(conversationId)?.idempotencyKey === attempt.idempotencyKey) {
        aiReplyKeys.current.delete(conversationId);
      }
      await Promise.all([selectAiConversation(conversationId), fetchAiInbox()]);
      if (deliveryQueued) {
        toast({
          title: "Resposta na fila",
          description: "A conversa será atualizada quando o envio for confirmado.",
        });
      }
    } catch (error) {
      const channelLabel = selectedAiConversation?.channel === "instagram" ? "Instagram" : "WhatsApp";
      toast({
        title: `Não foi possível enviar pelo ${channelLabel}.`,
        description: !receivedResponse
          ? "A confirmação não chegou. Tente novamente com o mesmo texto; o identificador da tentativa será reutilizado para evitar envio duplicado."
          : error instanceof Error ? error.message : "Verifique a conexão e tente novamente.",
        variant: "destructive",
      });
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
            <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Enviar Mensagem</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSend} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cliente</label>
                  <Popover open={sendClientPickerOpen} onOpenChange={setSendClientPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-label="Selecionar cliente para enviar mensagem"
                        aria-expanded={sendClientPickerOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">{selectedClientName || "Buscar e selecionar cliente..."}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          value={clientSearch}
                          onValueChange={setClientSearch}
                          placeholder="Buscar pelo nome do cliente..."
                          aria-label="Buscar cliente para a mensagem"
                        />
                        <CommandList className="max-h-[min(18rem,calc(100dvh-15rem))]">
                          <CommandEmpty>
                            {loadingMessageClients ? "Buscando clientes..." : "Nenhum cliente encontrado."}
                          </CommandEmpty>
                          <CommandGroup heading="Clientes">
                            {(messageClients?.data ?? []).map((client) => (
                              <CommandItem
                                key={client.id}
                                value={client.id}
                                onSelect={() => {
                                  setSelectedClientId(client.id);
                                  setSelectedClientName(client.name);
                                  setSelectedClientSnapshot({
                                    email: client.email ?? null,
                                    emailOptIn: client.emailOptIn ?? null,
                                    whatsapp: client.whatsapp ?? null,
                                    whatsappOptIn: client.whatsappOptIn ?? null,
                                  });
                                  setClientSearch("");
                                  setDebouncedClientSearch("");
                                  setSendClientPickerOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${selectedClientId === client.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="truncate">{client.name}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-xs text-muted-foreground">
                    Digite parte do nome para localizar clientes além dos primeiros resultados.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Canal de referência</label>
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
                    Cada conteúdo preenchido gera sua própria entrega. Esta opção registra o canal de referência.
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
                  Preencha um ou ambos os conteúdos. Campos vazios não geram entrega para aquele canal.
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
          <TabsTrigger value="conversations">Histórico por cliente</TabsTrigger>
          <TabsTrigger value="ai-inbox" className="flex items-center gap-1">
            <MessageSquare className="w-3.5 h-3.5" /> Atendimento multicanal
          </TabsTrigger>
          <TabsTrigger value="support-tickets" className="flex items-center gap-1">
            <TicketCheck className="w-3.5 h-3.5" /> Tickets
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
            retryingConversationIds={retryingConversationAiIds}
            queuedRetryConversationIds={queuedRetryConversationIds}
            conversationAiError={conversationAiError}
            failedConversationLabels={conversationAiFailureLabels}
            onOpenFailedConversation={openFailedWhatsAppConversation}
            onRetryConversationAiMessages={retryConversationAiMessages}
            selectedWhatsAppConversation={selectedWhatsAppConversation}
            selectedClientLinkStatus={selectedClientLinkStatus}
            onRetryClientLinkCheck={() => refetchSelectedConversationClientStatus()}
            onReassociateConversation={openSelectedConversationForReassociation}
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(270px,0.82fr)_minmax(0,1.8fr)]" aria-label="Carregando atendimentos" role="status">
              <div className="space-y-2 rounded-xl border p-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[68px] w-full rounded-lg" />)}</div>
              <Skeleton className="h-[420px] w-full rounded-xl" />
            </div>
          ) : aiInboxError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm" role="alert">
              <p>{aiInboxError}</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => { void fetchAiInbox(); }}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 md:h-[min(76dvh,760px)] md:min-h-[560px] md:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.8fr)]">
              <section aria-label="Lista de atendimentos" className={`flex min-h-[70dvh] flex-col overflow-hidden rounded-xl border bg-card shadow-sm md:min-h-0 ${selectedAiConversationId ? "hidden md:flex" : ""}`}>
                <div className="space-y-3 border-b bg-secondary/35 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">Atendimento multicanal</p>
                      <h2 className="mt-0.5 text-base font-semibold tracking-tight">Caixa de entrada</h2>
                    </div>
                    <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-card px-2 text-xs font-semibold tabular-nums ring-1 ring-border/70" aria-label={`${visibleAiConversations.length} atendimentos no filtro atual`}>
                      {visibleAiConversations.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar conversas por canal">
                      {([
                        { value: "all", label: "Todos" },
                        { value: "whatsapp", label: "WhatsApp" },
                        { value: "instagram", label: "Instagram" },
                      ] as const).map((option) => (
                        <Button
                          key={option.value}
                          type="button"
                          size="sm"
                          variant={aiInboxChannelFilter === option.value ? "secondary" : "ghost"}
                          aria-pressed={aiInboxChannelFilter === option.value}
                          data-testid={`button-ai-inbox-channel-${option.value}`}
                          className="h-7 rounded-full px-2.5 text-xs"
                          onClick={() => setAiInboxChannelFilter(option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar conversas por situação">
                      {([
                        { value: "all", label: "Todas", count: aiInboxStatusCounts.all },
                        { value: "human", label: "Com equipe", count: aiInboxStatusCounts.human },
                        { value: "automation", label: "Automação", count: aiInboxStatusCounts.automation },
                        { value: "opted_out", label: "Opt-out", count: aiInboxStatusCounts.opted_out },
                      ] as const).map((option) => (
                        <Button
                          key={option.value}
                          type="button"
                          size="sm"
                          variant={aiInboxStatusFilter === option.value ? "default" : "outline"}
                          aria-pressed={aiInboxStatusFilter === option.value}
                          data-testid={`button-ai-inbox-status-${option.value}`}
                          className="h-7 rounded-full px-2.5 text-xs"
                          onClick={() => setAiInboxStatusFilter(option.value)}
                        >
                          {option.label}
                          <span className="ml-1 tabular-nums opacity-75">{option.count}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      data-testid="input-search-ai-inbox"
                      aria-label="Pesquisar conversas"
                      value={aiInboxSearch}
                      onChange={(event) => setAiInboxSearch(event.target.value)}
                      placeholder="Buscar nome, @, mensagem..."
                      className="h-9 rounded-lg bg-background pl-9 text-sm"
                    />
                  </label>
                </div>
                <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                  {visibleAiConversations.length === 0 ? (
                    <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center text-muted-foreground">
                      {aiInboxSearch.trim() || aiInboxStatusFilter !== "all" ? (
                        <>
                          <Search className="mb-2 h-4 w-4" aria-hidden="true" />
                          <p className="text-sm font-medium text-foreground">Nenhum atendimento neste filtro</p>
                          <p className="mt-1 text-xs">Ajuste ou limpe os filtros para ver outras conversas.</p>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="mt-1"
                            data-testid="button-clear-ai-inbox-filters"
                            onClick={() => {
                              setAiInboxSearch("");
                              setAiInboxStatusFilter("all");
                              setAiInboxChannelFilter("all");
                            }}
                          >
                            Limpar filtros
                          </Button>
                        </>
                      ) : (
                        <>
                          <MessageSquare className="mb-2 h-5 w-5" aria-hidden="true" />
                          <p className="text-sm font-medium text-foreground">
                            {aiInboxChannelFilter === "instagram" ? "Nenhuma DM recebida ainda." : "Nenhum atendimento recebido ainda."}
                          </p>
                          <p className="mt-1 max-w-xs text-xs">As conversas iniciadas pelos clientes aparecem aqui quando a integração estiver conectada.</p>
                          {aiInboxChannelFilter !== "all" && (
                            <Button type="button" variant="link" size="sm" className="mt-1" onClick={() => setAiInboxChannelFilter("all")}>
                              Mostrar todos os canais
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ) : visibleAiConversations.map((conversation) => {
                    const client = conversation.clientId
                      ? aiInboxClientsById.get(conversation.clientId)
                      : undefined;
                    const displayName = getAiInboxDisplayName(conversation, client);
                    const channelIdentifier = getAiInboxChannelIdentifier(conversation, client);
                    const clientTags = (client?.tags ?? []).filter(Boolean);
                    return (
                      <button
                        key={conversation.id}
                        data-testid={`button-ai-inbox-conversation-${conversation.id}`}
                        type="button"
                        aria-pressed={selectedAiConversationId === conversation.id}
                        onClick={() => selectAiConversation(conversation.id)}
                        className={`relative w-full p-3.5 text-left transition-colors hover:bg-secondary/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedAiConversationId === conversation.id ? "bg-primary/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : ""}`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar className={`h-10 w-10 shrink-0 ${selectedAiConversationId === conversation.id ? "ring-2 ring-primary ring-offset-2" : ""}`} aria-hidden="true">
                            <AvatarImage src={client?.photoUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
                              {getAiInboxInitials(displayName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <p className="min-w-0 truncate text-sm font-semibold">
                                {displayName}
                              </p>
                              <Badge className="h-5 shrink-0 rounded-md px-1.5 text-[10px]" variant={conversation.status === "human_handoff" ? "default" : "secondary"}>
                                {conversation.status === "human_handoff"
                                  ? "Humano"
                                  : conversation.status === "opted_out"
                                    ? "Opt-out"
                                    : "Automação"}
                              </Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {conversation.lastMessageRole === "assistant" && <span className="font-medium text-foreground/70">{conversation.lastMessageIsBot ? "IA: " : "Equipe: "}</span>}
                              {conversation.lastMessageContent || "Atendimento iniciado"}
                            </p>
                            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                              <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${conversation.channel === "instagram" ? "text-pink-700 dark:text-pink-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                                {conversation.channel === "instagram"
                                  ? <Instagram className="h-3 w-3" aria-hidden="true" />
                                  : <MessageCircle className="h-3 w-3" aria-hidden="true" />}
                                {conversation.channel === "instagram" ? "Instagram Direct" : "WhatsApp"}
                              </span>
                              {channelIdentifier && (
                                <span className="inline-flex min-w-0 items-center gap-1 truncate" title={channelIdentifier}>
                                  {conversation.channel === "instagram"
                                    ? <Instagram className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    : <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                  <span className="truncate">{channelIdentifier}</span>
                                </span>
                              )}
                              <span className="shrink-0 tabular-nums" title={new Date(conversation.lastMessageAt ?? conversation.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}>
                                {new Date(conversation.lastMessageAt ?? conversation.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                <span aria-hidden="true"> · </span>{conversation.messageCount} mensagens
                              </span>
                            </div>
                            {clientTags.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {clientTags.slice(0, 2).map((tag) => (
                                  <span key={tag} className="max-w-28 truncate rounded-full bg-secondary px-1.5 py-0.5 text-[10px] leading-none text-secondary-foreground" title={tag}>
                                    {tag}
                                  </span>
                                ))}
                                {clientTags.length > 2 && (
                                  <span className="text-[10px] leading-tight text-muted-foreground">
                                    +{clientTags.length - 2}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section aria-label={selectedAiConversationId ? "Histórico do atendimento selecionado" : "Atendimento selecionado"} className={`min-h-[70dvh] min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm md:min-h-0 ${selectedAiConversationId ? "flex" : "hidden md:flex"}`}>
                {!selectedAiConversationId ? (
                  <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
                    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary"><MessageSquare className="h-5 w-5" aria-hidden="true" /></span>
                    <p className="text-sm font-medium text-foreground">Escolha um atendimento</p>
                    <p className="mt-1 text-xs">Selecione uma conversa para abrir o histórico.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-3 py-3 sm:px-4">
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 md:hidden"
                          aria-label="Voltar para a lista de conversas"
                          data-testid="button-back-to-ai-inbox"
                          onClick={() => {
                            setSelectedAiConversationId(null);
                            setAiMessages([]);
                          }}
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">
                          {selectedAiConversation ? getInstagramIdentity(selectedAiConversation).slice(0, 2).toLocaleUpperCase("pt-BR") : "CM"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{selectedAiConversation ? getInstagramIdentity(selectedAiConversation) : "Contato sem identificação"}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
                              {selectedAiConversation?.channel === "instagram" ? "Instagram Direct" : "WhatsApp"}
                            </Badge>
                            {selectedAiClient && selectedAiConversation && selectedAiClient.name !== getInstagramIdentity(selectedAiConversation) && (
                              <span className="truncate text-xs text-muted-foreground">{selectedAiClient.name}</span>
                            )}
                            <span className={`inline-flex items-center gap-1 text-[11px] ${selectedAiConversation?.status === "human_handoff" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${selectedAiConversation?.status === "human_handoff" ? "bg-emerald-500" : "bg-slate-400"}`} />
                              {selectedAiConversation?.status === "human_handoff" ? "Equipe atendendo" : selectedAiConversation?.status === "opted_out" ? "Opt-out" : "Automação"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
                        {selectedInstagramProfileUrl && (
                          <Button asChild variant="outline" size="sm" className="h-9">
                            <a href={selectedInstagramProfileUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir perfil no Instagram" data-testid="link-open-instagram-profile">
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Instagram
                            </a>
                          </Button>
                        )}
                        {selectedWhatsAppUrl && (
                          <Button asChild variant="outline" size="sm" className="h-9">
                            <a href={selectedWhatsAppUrl} target="_blank" rel="noopener noreferrer" aria-label="Falar com cliente pelo WhatsApp" data-testid="link-open-client-whatsapp">
                              <MessageCircle className="mr-1.5 h-3.5 w-3.5" />WhatsApp
                            </a>
                          </Button>
                        )}
                        {selectedEmailUrl && (
                          <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                            <a href={selectedEmailUrl} aria-label="Enviar e-mail para o cliente" data-testid="link-email-client">
                              <MailIcon className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Popover open={aiClientPickerOpen} onOpenChange={setAiClientPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-label="Associar atendimento a cliente"
                            aria-expanded={aiClientPickerOpen}
                            data-testid="button-associar-atendimento-cliente"
                            disabled={associatingAiConversationId === selectedAiConversationId}
                            className="h-9 w-full justify-between gap-2 px-2.5 text-left font-normal sm:w-[220px]"
                          >
                            <span className="flex min-w-0 flex-col items-start">
                              <span className="truncate text-xs font-medium">
                                {selectedAiClient?.name ?? "Associar cliente"}
                              </span>
                              <span className="flex max-w-full items-center gap-1 truncate text-[10px] text-muted-foreground">
                                {selectedAiClient
                                  ? [selectedAiClient.addressCity, selectedAiClient.addressState].filter(Boolean).join("/")
                                    || "Localidade não informada"
                                  : "Buscar por nome, Instagram ou cidade"}
                              </span>
                            </span>
                            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="bottom"
                          className="w-[min(26rem,calc(100vw-2rem))] p-0"
                        >
                          <Command>
                            <CommandInput
                              data-testid="input-buscar-cliente-associacao"
                              placeholder="Buscar por nome, Instagram ou cidade..."
                            />
                            <CommandList className="max-h-[min(22rem,calc(100dvh-10rem))]">
                              <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                              <CommandGroup heading="Vínculo do atendimento">
                                <CommandItem
                                  value="sem cliente associado remover vínculo"
                                  data-testid="option-sem-cliente-associado"
                                  onSelect={() => {
                                    setAiClientPickerOpen(false);
                                    void handleAssociateAiClient(NO_ASSOCIATED_CLIENT);
                                  }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${selectedAiConversation?.clientId ? "opacity-0" : "opacity-100"}`} />
                                  <span>Sem cliente associado</span>
                                </CommandItem>
                              </CommandGroup>
                              <CommandGroup heading="Clientes">
                                {(clients?.data ?? []).map((client) => {
                                  const location = [client.addressCity, client.addressState]
                                    .filter(Boolean)
                                    .join("/") || "Localidade não informada";
                                  const instagram = client.instagram?.trim();
                                  const instagramLabel = instagram
                                    ? `@${instagram.replace(/^@+/, "")}`
                                    : null;
                                  return (
                                    <CommandItem
                                      key={client.id}
                                      value={`${client.name} ${instagram ?? ""} ${location}`}
                                      data-testid={`option-cliente-associacao-${client.id}`}
                                      onSelect={() => {
                                        setAiClientPickerOpen(false);
                                        void handleAssociateAiClient(client.id);
                                      }}
                                      className="items-start py-2.5"
                                    >
                                      <Check className={`mr-2 mt-0.5 h-4 w-4 shrink-0 ${selectedAiConversation?.clientId === client.id ? "opacity-100" : "opacity-0"}`} />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{client.name}</span>
                                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                          {instagramLabel && <span className="truncate">{instagramLabel}</span>}
                                          <span className="inline-flex min-w-0 items-center gap-1">
                                            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{location}</span>
                                          </span>
                                        </span>
                                      </span>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    <div ref={aiMessagesScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/55 px-3 py-4 sm:px-5" aria-label="Mensagens do atendimento" role="log" aria-live="polite">
                      {!loadingAiMessages && !aiMessagesError && aiTimelineHasMore && (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => { void loadOlderAiMessages(); }}
                            disabled={loadingOlderAiMessages}
                            aria-busy={loadingOlderAiMessages}
                          >
                            {loadingOlderAiMessages ? "Carregando mensagens anteriores..." : "Carregar mensagens anteriores"}
                          </Button>
                        </div>
                      )}
                      {loadingAiMessages ? (
                        <div className="space-y-3" aria-label="Carregando histórico"><Skeleton className="h-16 w-3/4 rounded-2xl" /><Skeleton className="ml-auto h-16 w-2/3 rounded-2xl" /><Skeleton className="h-16 w-1/2 rounded-2xl" /></div>
                      ) : aiMessagesError ? (
                        <div className="flex h-full min-h-40 flex-col items-center justify-center text-center" role="alert">
                          <p className="text-sm text-destructive">{aiMessagesError}</p>
                          <Button type="button" className="mt-3" variant="outline" size="sm" onClick={() => { void selectAiConversation(selectedAiConversationId); }}>Tentar novamente</Button>
                        </div>
                      ) : aiMessages.length === 0 ? (
                        <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-muted-foreground">
                          <MessageSquare className="mb-2 h-5 w-5 opacity-60" aria-hidden="true" />
                          <p className="text-sm font-medium text-foreground">Ainda não há mensagens neste atendimento.</p>
                        </div>
                      ) : aiMessages.map((message) => {
                        const inbound = message.role === "user";
                        const senderLabel = inbound ? "Cliente" : message.isBot ? "Resposta automática" : "Equipe";
                        const deliveryLabel = message.deliveryStatus === "read"
                          ? "Lida"
                          : message.deliveryStatus === "delivered"
                            ? "Entregue"
                            : message.deliveryStatus === "failed"
                              ? "Falhou"
                                : message.deliveryStatus === "skipped"
                                  ? "Não enviada"
                              : message.deliveryStatus === "cancelled"
                                ? "Cancelada"
                              : message.deliveryStatus === "unknown"
                                ? "Sem confirmação"
                                : message.deliveryStatus === "sending" || message.deliveryStatus === "pending" || message.deliveryStatus === "processing"
                                  ? "Na fila"
                                : message.deliveryStatus === "sent"
                                  ? "Enviada"
                                  : null;
                        return (
                          <div key={message.id} data-testid={`message-inbox-${message.id}`} className={`flex min-w-0 ${inbound ? "justify-start" : "justify-end"}`}>
                            <div className={`min-w-0 max-w-[min(92%,38rem)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm sm:max-w-[82%] ${inbound ? "rounded-tl-md border border-border/80 bg-card" : message.isBot ? "rounded-tr-md bg-accent/70 text-foreground" : "rounded-tr-md bg-primary text-primary-foreground"}`}>
                              <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${inbound ? "text-muted-foreground" : message.isBot ? "text-muted-foreground" : "text-primary-foreground/75"}`}>{senderLabel}</p>
                              <p className="whitespace-pre-wrap break-words">{message.content || (message.mediaUrl ? "Mídia recebida" : "Mensagem sem texto")}</p>
                               {(message.mediaUrl || message.mediaMimeType || message.mediaExpiredAt) && (
                                 <MessageMediaAttachment
                                   url={message.mediaUrl}
                                   mimeType={message.mediaMimeType}
                                   fileName={message.mediaFileName}
                                   expiredAt={message.mediaExpiredAt}
                                   expiresAt={message.mediaExpiresAt}
                                 />
                               )}
                              <div className={`mt-1.5 flex items-center justify-end gap-1.5 text-[10px] ${inbound || message.isBot ? "text-muted-foreground" : "text-primary-foreground/75"}`}>
                                <time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</time>
                                {!inbound && deliveryLabel && <span aria-label={`Status: ${deliveryLabel}`}>· {deliveryLabel}</span>}
                              </div>
                              {!inbound && (message.channel || message.provider || message.origin || message.deliveryAttempts != null) && (
                                <p className={`mt-1 break-all text-[10px] ${message.isBot ? "text-muted-foreground" : "text-primary-foreground/75"}`}>
                                  {[message.channel, message.provider ? `Provedor: ${message.provider}` : null, message.origin ? `Origem: ${message.origin}` : null, message.deliveryAttempts != null ? `${message.deliveryAttempts} tentativa(s)` : null, message.externalId ? `ID: ${message.externalId}` : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                              {!inbound && Boolean(message.deliveryHistory?.length) && (
                                <details className={`mt-1 text-[10px] ${message.isBot ? "text-muted-foreground" : "text-primary-foreground/75"}`}>
                                  <summary className="cursor-pointer">Detalhes das tentativas ({message.deliveryHistory!.length})</summary>
                                  <ul className="mt-1 space-y-1 break-all pl-3">
                                    {message.deliveryHistory!.map((attempt) => (
                                      <li key={`${message.id}-${attempt.attemptNumber}`}>
                                        Tentativa {attempt.attemptNumber}: {attempt.status}
                                        {attempt.provider ? ` · ${attempt.provider}` : ""}
                                        {attempt.externalId ? ` · ID ${attempt.externalId}` : ""}
                                        {attempt.startedAt ? ` · ${new Date(attempt.startedAt).toLocaleString("pt-BR")}` : ""}
                                        {attempt.error ? " · O provedor informou uma falha." : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                              {!inbound && message.deliveryIssue && (
                                <p
                                  role="status"
                                  aria-label="Detalhe do envio"
                                  className={`mt-2 border-t pt-2 text-xs ${message.isBot ? "border-destructive/20 text-destructive" : "border-primary-foreground/20 text-primary-foreground"}`}
                                >
                                  {message.deliveryIssue}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="border-t bg-card px-3 py-3 sm:px-4">
                      {selectedAiConversation?.channel === "instagram" && (
                        <div id={`instagram-reply-rules-${selectedAiConversationId}`} className={`mb-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${instagramReplyWindowExpired || instagramReplyTooLong ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-secondary/45 text-muted-foreground"}`} role={instagramReplyWindowExpired || instagramReplyTooLong ? "alert" : "note"}>
                          <p className="font-semibold text-foreground">Regras do Instagram Direct</p>
                          <p className="mt-0.5">Responda somente a DMs iniciadas pelo cliente e em até 24 horas da última mensagem recebida. Texto simples, até 1.000 bytes.</p>
                          {instagramReplyWindowExpired && <p className="mt-1 font-medium">Janela encerrada. Peça ao cliente para enviar uma nova DM antes de responder.</p>}
                          {instagramReplyTooLong && <p className="mt-1 font-medium">Esta mensagem excede o limite permitido de 1.000 bytes.</p>}
                        </div>
                      )}
                        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span>Responder pelo {selectedAiConversation?.channel === "instagram" ? "Instagram Direct" : "WhatsApp"}</span>
                          <span>As mensagens aparecem no histórico após o envio.</span>
                        </div>
                        <form onSubmit={handleAiReply} className="flex min-w-0 items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <Textarea
                              data-testid={selectedAiConversation?.channel === "instagram" ? "textarea-ai-inbox-instagram-reply" : "textarea-ai-inbox-whatsapp-reply"}
                              aria-label={selectedAiConversation?.channel === "instagram" ? "Responder no Instagram Direct" : "Responder no atendimento WhatsApp"}
                              aria-describedby={selectedAiConversation?.channel === "instagram" ? `instagram-reply-rules-${selectedAiConversationId}` : undefined}
                              className="min-h-11 max-h-36 resize-y rounded-xl"
                              rows={2}
                              placeholder={selectedAiConversation?.channel === "instagram" ? "Escreva sua resposta para o Direct..." : "Escreva sua resposta para o cliente..."}
                              value={aiReply}
                              onChange={(e) => setAiReply(e.target.value)}
                              disabled={selectedAiConversation?.channel === "instagram" && instagramReplyWindowExpired}
                            />
                          {selectedAiConversation?.channel === "instagram" && (
                            <p
                              data-testid="text-ai-inbox-instagram-byte-count"
                              className={`mt-1 text-right text-[11px] tabular-nums ${instagramReplyTooLong ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                              aria-live="polite"
                            >
                              {getInstagramReplyByteCount(aiReply)} / {INSTAGRAM_REPLY_MAX_BYTES.toLocaleString("pt-BR")} bytes
                            </p>
                          )}
                        </div>
                        <Button
                          data-testid="button-ai-inbox-send-reply"
                          type="submit"
                          size="sm"
                          className="h-11 shrink-0 rounded-xl px-3 sm:px-4"
                          aria-label={selectedAiConversation?.channel === "instagram" ? "Enviar resposta no Instagram Direct" : "Enviar resposta no atendimento WhatsApp"}
                          disabled={sendingAiReply || !aiReply.trim() || (selectedAiConversation?.channel === "instagram" && (instagramReplyWindowExpired || instagramReplyTooLong))}
                        >
                          {sendingAiReply ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          <span className="ml-2 hidden sm:inline">Enviar</span>
                        </Button>
                      </form>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="support-tickets" className="mt-4">
          <SupportTicketsTab />
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
