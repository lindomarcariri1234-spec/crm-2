import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMessages,
  useSendMessage,
  useListMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
  useCreateOutboundMessage,
  useListOutboundMessages,
  useListOutboundProviderFailureSummary,
  useRetryOutboundDelivery,
} from "@workspace/api-client-react";
import { useListClients } from "@workspace/api-client-react";
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
} from "@workspace/api-client-react";
import { QueryErrorState } from "@/components/query-error-state";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  reservationId: string | null;
  isAutoRetry: boolean;
  createdAt: string;
}

interface FailedEmailSummary {
  emailLogId: string | null;
  reservationId: string;
  reservationNumber: string | null;
  clientName: string;
  clientEmail: string | null;
  exhaustedAt: string;
}

interface AiConversation {
  id: string;
  clientId: string | null;
  channel: string;
  status: string;
  assignedUserId: string | null;
  sessionId: string | null;
  startedAt: string;
  createdAt: string;
}

interface AiMessage {
  id: string;
  role: string;
  content: string;
  isBot: boolean;
  sentAt: string;
}

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "sms", label: "SMS" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "internal", label: "Interno" },
];

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
};

const outboundDeliveryStatusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  accepted: "Aceita pelo provedor",
  failed: "Falha confirmada",
  skipped: "Ignorada",
};

type OutboundDeliveryFilterStatus = "all" | "pending" | "processing" | "accepted" | "failed" | "skipped";
type BounceTypeFilter = "all" | "permanent" | "temporary";
const UNKNOWN_PROVIDER_FILTER = "__unknown__";
const bounceTypeLabels: Record<Exclude<BounceTypeFilter, "all">, string> = {
  permanent: "Bounce permanente",
  temporary: "Falha temporária",
};

export default function Communication() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("conversations");
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);

  const [sendChannel, setSendChannel] = useState("whatsapp");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [messageContent, setMessageContent] = useState("");
  const [emailSubject, setEmailSubject] = useState("Mensagem da agência");
  const [emailContent, setEmailContent] = useState("");
  const [whatsappContent, setWhatsappContent] = useState("");
  const [tplChannel, setTplChannel] = useState("whatsapp");

  const [selectedConversationClientId, setSelectedConversationClientId] = useState<string | null>(null);
  const [inboxChannel, setInboxChannel] = useState("whatsapp");
  const [inboxMessage, setInboxMessage] = useState("");
  const [aiConversations, setAiConversations] = useState<AiConversation[]>([]);
  const [selectedAiConversationId, setSelectedAiConversationId] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiReply, setAiReply] = useState("");
  const [loadingAiInbox, setLoadingAiInbox] = useState(false);
  const [sendingAiReply, setSendingAiReply] = useState(false);
  const aiReplyKey = useRef<string | null>(null);

  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [emailLogsError, setEmailLogsError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [filterAutoRetry, setFilterAutoRetry] = useState<"all" | "auto" | "manual" | "exhausted" | "indicacoes">("all");
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
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyExporting, setHistoryExporting] = useState<"csv" | "pdf" | null>(null);

  const REFERRAL_EMAIL_RE = /bônus de indicação|indicação foi confirmada|indicação expirou|⏰|vence em \d+ dia/i;

  function getEmailTypeLabel(log: { reservationId: string | null; subject?: string | null }): string {
    const s = log.subject ?? "";
    if (/bônus de indicação foi pago/i.test(s)) return "Bônus pago";
    if (/indicação foi confirmada/i.test(s)) return "Indicação convertida";
    if (/indicação expirou/i.test(s)) return "Indicação expirada";
    if (/vence em \d+ dia|⏰/i.test(s)) return "Aviso de expiração";
    if (/bem-vindo|área do cliente/i.test(s)) return "Boas-vindas";
    if (/^nova reserva/i.test(s)) return "Nova reserva";
    if (log.reservationId) return "Confirmação";
    return "Transacional";
  }

  const [failedSummary, setFailedSummary] = useState<FailedEmailSummary[]>([]);
  const [loadingFailedSummary, setLoadingFailedSummary] = useState(false);
  const [failedSummaryError, setFailedSummaryError] = useState<string | null>(null);

  const MAX_AUTO_RETRY_ATTEMPTS = 3;

  const exhaustedReservationIds = useMemo(() => {
    const byReservation = new Map<string, { autoRetryFailed: number; hasSent: boolean }>();
    for (const log of emailLogs) {
      if (!log.reservationId) continue;
      const rid = log.reservationId;
      if (!byReservation.has(rid)) byReservation.set(rid, { autoRetryFailed: 0, hasSent: false });
      const r = byReservation.get(rid)!;
      if (log.status === "sent") r.hasSent = true;
      if (log.isAutoRetry && log.status === "failed") r.autoRetryFailed++;
    }
    const exhausted = new Set<string>();
    for (const [rid, r] of byReservation.entries()) {
      if (!r.hasSent && r.autoRetryFailed >= MAX_AUTO_RETRY_ATTEMPTS) exhausted.add(rid);
    }
    return exhausted;
  }, [emailLogs]);

  const fetchEmailLogs = useCallback(async () => {
    setLoadingEmailLogs(true);
    setEmailLogsError(null);
    try {
      const res = await fetch(`${BASE}/api/email-logs`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setEmailLogs(data ?? []);
      } else {
        const body = await res.json().catch(() => ({}));
        setEmailLogsError(body.error ?? "Erro ao carregar o log de e-mails. Tente novamente.");
      }
    } catch {
      setEmailLogsError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setLoadingEmailLogs(false);
    }
  }, []);

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
    if (tab === "email-logs") {
      fetchEmailLogs();
    } else if (tab === "failed-emails") {
      fetchFailedSummary();
    }
  }, [tab, fetchEmailLogs, fetchFailedSummary]);

  const fetchAiInbox = useCallback(async () => {
    setLoadingAiInbox(true);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      setAiConversations(await res.json());
    } catch {
      toast({ title: "Não foi possível carregar o atendimento por IA.", variant: "destructive" });
    } finally {
      setLoadingAiInbox(false);
    }
  }, [toast]);

  const selectAiConversation = useCallback(async (id: string) => {
    setSelectedAiConversationId(id);
    try {
      const res = await fetch(`${BASE}/api/chatbot-conversations/${id}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      setAiMessages(await res.json());
    } catch {
      toast({ title: "Não foi possível carregar o histórico.", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    if (tab === "ai-inbox") fetchAiInbox();
  }, [tab, fetchAiInbox]);

  const handleResend = async (id: string) => {
    setResendingId(id);
    try {
      const res = await fetch(`${BASE}/api/email-logs/${id}/resend`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "E-mail reenfileirado para reenvio." });
        fetchEmailLogs();
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

  const { data: messages, isLoading: loadingMessages, isError: messagesError, error: messagesQueryError, refetch: refetchMessages } =
    useListMessages({ limit: 50 });
  const { data: templates, isLoading: loadingTemplates, isError: templatesError, error: templatesQueryError, refetch: refetchTemplates } =
    useListMessageTemplates();
  const { data: clients } = useListClients({ limit: 200 });

  const sendMessage = useSendMessage();
  const createOutboundMessage = useCreateOutboundMessage();
  const retryOutboundDelivery = useRetryOutboundDelivery();
  const {
    data: outboundMessages,
    isLoading: loadingOutboundMessages,
    isError: outboundMessagesError,
    error: outboundMessagesQueryError,
    refetch: refetchOutboundMessages,
  } = useListOutboundMessages({
    limit: 200,
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
  });
  const {
    data: providerFailureSummary,
    isLoading: loadingProviderFailureSummary,
    isError: providerFailureSummaryError,
  } = useListOutboundProviderFailureSummary({
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
  });

  useEffect(() => {
    const stream = new EventSource(`${BASE}/api/outbound-messages/stream`, { withCredentials: true });
    const refreshHistory = (event: Event) => {
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
  }, [queryClient, toast]);
  const createTemplate = useCreateMessageTemplate();
  const updateTemplate = useUpdateMessageTemplate();
  const deleteTemplate = useDeleteMessageTemplate();

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const emailHtml = emailContent.trim() || messageContent.trim();
    const whatsappText = whatsappContent.trim() || messageContent.trim();
    await createOutboundMessage.mutateAsync({
      data: {
        eventType: "manual_message",
        idempotencyKey: `manual:${crypto.randomUUID()}`,
        recipient: { type: "client", id: selectedClientId },
        email: { subject: emailSubject.trim() || "Mensagem da agência", html: emailHtml },
        whatsapp: { text: whatsappText },
        origin: "user",
        originChannel: sendChannel as "email" | "whatsapp",
      },
    });
    setIsSendOpen(false);
    setSelectedClientId("");
    setSendChannel("whatsapp");
    setMessageContent("");
    setEmailContent("");
    setWhatsappContent("");
    setEmailSubject("Mensagem da agência");
    toast({ title: "Mensagem sincronizada criada", description: "As entregas de E-mail e WhatsApp foram programadas." });
    refetchOutboundMessages();
    refetchMessages();
  };

  const handleCreateTemplate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editingTemplate) {
      await updateTemplate.mutateAsync({
        id: editingTemplate.id,
        data: {
          name: fd.get("name") as string,
          subject: (fd.get("subject") as string) || null,
          content: fd.get("content") as string,
          category: (fd.get("category") as string) || null,
        },
      });
    } else {
      await createTemplate.mutateAsync({
        data: {
          name: fd.get("name") as string,
          channel: tplChannel,
          subject: (fd.get("subject") as string) || undefined,
          content: fd.get("content") as string,
          category: (fd.get("category") as string) || undefined,
          variables: [],
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

  const selectedClient = (clients?.data ?? []).find((client) => client.id === selectedClientId);
  const uniqueHistoryOrigins = useMemo(
    () => Array.from(new Set((outboundMessages ?? []).map((message) => message.origin))).sort(),
    [outboundMessages],
  );
  const uniqueHistoryProviders = useMemo(
    () => Array.from(new Set([
      ...(outboundMessages ?? []).flatMap((message) => message.deliveries.map((delivery) => delivery.provider).filter((provider): provider is string => Boolean(provider))),
      ...(providerFailureSummary ?? []).map((item) => item.provider).filter((provider): provider is string => Boolean(provider)),
    ])).sort(),
    [outboundMessages, providerFailureSummary],
  );
  const hasUnknownHistoryProvider = useMemo(
    () => (providerFailureSummary ?? []).some((item) => item.provider === null),
    [providerFailureSummary],
  );
  const filteredOutboundMessages = useMemo(() => {
    const from = historyDateFrom ? new Date(`${historyDateFrom}T00:00:00`) : null;
    const to = historyDateTo ? new Date(`${historyDateTo}T23:59:59.999`) : null;
    return (outboundMessages ?? []).flatMap((message) => {
      const date = new Date(message.createdAt);
      if (historyStatus !== "all" && message.status !== historyStatus) return [];
      if (historyOrigin !== "all" && message.origin !== historyOrigin) return [];
      if (historyClientId !== "all" && message.recipientId !== historyClientId) return [];
      if (from && date < from) return [];
      if (to && date > to) return [];
      const deliveries = message.deliveries.filter((delivery) => (
        (historyChannel === "all" || delivery.channel === historyChannel) &&
        (historyDeliveryStatus === "all" || delivery.status === historyDeliveryStatus) &&
        (historyBounceType === "all" || delivery.bounceType === historyBounceType) &&
        (historyProvider === "all" || delivery.provider === historyProvider)
      ));
      if (deliveries.length === 0) return [];
      return [{ ...message, deliveries }];
    });
  }, [outboundMessages, historyStatus, historyDeliveryStatus, historyBounceType, historyProvider, historyOrigin, historyClientId, historyDateFrom, historyDateTo, historyChannel]);
  const failedDeliveryCount = useMemo(
    () => filteredOutboundMessages.reduce(
      (count, message) => count + message.deliveries.filter((delivery) => delivery.status === "failed").length,
      0,
    ),
    [filteredOutboundMessages],
  );
  const openProviderFailures = (provider: string | null) => {
    setHistoryProvider(provider ?? UNKNOWN_PROVIDER_FILTER);
    setHistoryDeliveryStatus("failed");
    setExpandedHistoryId(null);
  };
  const bounceTypeCounts = useMemo(() => ({
    permanent: filteredOutboundMessages.reduce((count, message) => count + message.deliveries.filter((delivery) => delivery.bounceType === "permanent").length, 0),
    temporary: filteredOutboundMessages.reduce((count, message) => count + message.deliveries.filter((delivery) => delivery.bounceType === "temporary").length, 0),
  }), [filteredOutboundMessages]);
  const openBounceType = (bounceType: Exclude<BounceTypeFilter, "all">) => {
    setHistoryBounceType(bounceType);
    setExpandedHistoryId(null);
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

  const filteredMessages =
    filterChannel === "all"
      ? (messages ?? [])
      : (messages ?? []).filter((m) => m.channel === filterChannel);

  const conversations = useMemo(() => {
    const byClient: Record<string, { clientId: string; clientName: string; lastMessage: Message; count: number }> = {};
    for (const m of messages ?? []) {
      const cid = m.toClientId;
      if (!cid) continue;
      if (!byClient[cid]) {
        byClient[cid] = { clientId: cid, clientName: m.clientName ?? cid, lastMessage: m, count: 0 };
      }
      byClient[cid].count += 1;
      if (new Date(m.sentAt) > new Date(byClient[cid].lastMessage.sentAt)) {
        byClient[cid].lastMessage = m;
      }
    }
    return Object.values(byClient).sort((a, b) => new Date(b.lastMessage.sentAt).getTime() - new Date(a.lastMessage.sentAt).getTime());
  }, [messages]);

  const conversationMessages = useMemo(() => {
    if (!selectedConversationClientId) return [];
    return (messages ?? [])
      .filter(m => m.toClientId === selectedConversationClientId)
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
  }, [messages, selectedConversationClientId]);

  const handleSendInbox = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedConversationClientId || !inboxMessage.trim()) return;
    await sendMessage.mutateAsync({
      data: {
        toClientId: selectedConversationClientId,
        channel: inboxChannel,
        content: inboxMessage,
      },
    });
    setInboxMessage("");
    refetchMessages();
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comunicação"
        description="Envie mensagens e gerencie templates omnicanal."
        actions={
          <>
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
                        {CHANNELS.map((ch) => (
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
                {(tplChannel === "email") && (
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
                    placeholder="Olá {nome}, sua reserva foi confirmada para {viagem} em {data}."
                    defaultValue={editingTemplate?.content ?? ""}
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <WholeWord className="w-3.5 h-3.5" />
                    Use {"{nome}"}, {"{viagem}"}, {"{data}"} como variáveis.
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
                  <Select
                    value={selectedClientId}
                    onValueChange={setSelectedClientId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients?.data?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Iniciar por</label>
                  <Select value={sendChannel} onValueChange={setSendChannel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((ch) => (
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
                        setMessageContent(tpl.content);
                        if (tpl.subject) setEmailSubject(tpl.subject);
                      } else if (tpl) {
                        setWhatsappContent(tpl.content);
                        setMessageContent(tpl.content);
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
                      required
                    />
                    <Textarea
                      rows={5}
                      placeholder="HTML ou texto do e-mail..."
                      value={emailContent}
                      onChange={(e) => { setEmailContent(e.target.value); setMessageContent(e.target.value); }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Conteúdo do WhatsApp</label>
                    <Textarea
                      rows={7}
                      placeholder="Texto do WhatsApp..."
                      value={whatsappContent}
                      onChange={(e) => { setWhatsappContent(e.target.value); setMessageContent(e.target.value); }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cada canal usa seu próprio conteúdo. Se um campo ficar vazio, o servidor registrará a entrega como ignorada.
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
                    {createOutboundMessage.isPending ? "Programando..." : "Programar E-mail + WhatsApp"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="ai-inbox" className="flex items-center gap-1">
            <MessageSquare className="w-3.5 h-3.5" /> Atendimento IA
          </TabsTrigger>
          <TabsTrigger value="messages">Mensagens Enviadas</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="email-logs" className="flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> Histórico Multicanal
          </TabsTrigger>
          <TabsTrigger value="failed-emails" className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            E-mails Falhos
            {failedSummary.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold w-5 h-5">
                {failedSummary.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="mt-4">
          {loadingMessages ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              <div className="col-span-2"><Skeleton className="h-[400px] w-full" /></div>
            </div>
          ) : messagesError ? (
            <QueryErrorState resourceLabel="as mensagens" error={messagesQueryError} onRetry={() => { void refetchMessages(); }} />
          ) : conversations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Nenhuma conversa ainda.</p>
              <p className="text-sm mt-1">Envie uma mensagem para iniciar uma conversa com um cliente.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[520px]">
              <div className="border rounded-lg overflow-hidden flex flex-col">
                <div className="p-3 border-b bg-muted/30">
                  <p className="text-sm font-semibold">Clientes ({conversations.length})</p>
                </div>
                <div className="flex-1 overflow-y-auto divide-y">
                  {conversations.map(conv => (
                    <button
                      key={conv.clientId}
                      onClick={() => setSelectedConversationClientId(conv.clientId)}
                      className={`w-full text-left p-3 hover:bg-muted/40 transition-colors ${selectedConversationClientId === conv.clientId ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                    >
                      <div className="flex items-start justify-between">
                        <p className="font-medium text-sm truncate">{conv.clientName}</p>
                        <span className="text-xs text-muted-foreground shrink-0 ml-1">
                          {new Date(conv.lastMessage.sentAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{conv.lastMessage.content}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge className={`text-xs ${channelColors[conv.lastMessage.channel] ?? ""}`} variant="secondary">
                          {CHANNELS.find(c => c.value === conv.lastMessage.channel)?.label ?? conv.lastMessage.channel}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{conv.count} msg</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2 border rounded-lg overflow-hidden flex flex-col">
                {!selectedConversationClientId ? (
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
                        <p className="font-semibold text-sm">
                          {conversations.find(c => c.clientId === selectedConversationClientId)?.clientName}
                        </p>
                        <p className="text-xs text-muted-foreground">{conversationMessages.length} mensagem(ns)</p>
                      </div>
                      <Select value={inboxChannel} onValueChange={setInboxChannel}>
                        <SelectTrigger className="w-32 h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHANNELS.map(ch => (
                            <SelectItem key={ch.value} value={ch.value}>{ch.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {conversationMessages.map(m => (
                        <div key={m.id} className="flex justify-end">
                          <div className="max-w-xs">
                            <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 text-sm">
                              {m.content}
                            </div>
                            <div className="flex items-center justify-end gap-1.5 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {new Date(m.sentAt).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                              </span>
                              <span className="text-xs">{statusIcons[m.status] ?? null}</span>
                              <Badge className={`text-xs ${channelColors[m.channel] ?? ""}`} variant="secondary">
                                {CHANNELS.find(c => c.value === m.channel)?.label ?? m.channel}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 border-t">
                      <form onSubmit={handleSendInbox} className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Digite sua mensagem..."
                          value={inboxMessage}
                          onChange={e => setInboxMessage(e.target.value)}
                        />
                        <Button type="submit" size="sm" disabled={sendMessage.isPending || !inboxMessage.trim()}>
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

        <TabsContent value="ai-inbox" className="mt-4">
          {loadingAiInbox ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              <div className="col-span-2"><Skeleton className="h-[400px] w-full" /></div>
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
                    <div className="p-3 border-b bg-muted/30">
                      <p className="font-semibold text-sm">Atendimento WhatsApp</p>
                      <p className="text-xs text-muted-foreground">A IA interrompe respostas ao detectar uma solicitação de atendimento humano.</p>
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

        <TabsContent value="messages" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Filtrar:</span>
            {["all", ...CHANNELS.map((c) => c.value)].map((ch) => (
              <button
                key={ch}
                onClick={() => setFilterChannel(ch)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterChannel === ch
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {ch === "all"
                  ? "Todos"
                  : CHANNELS.find((c) => c.value === ch)?.label ?? ch}
              </button>
            ))}
          </div>

          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enviado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingMessages ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : messagesError ? (
                  <TableRow><TableCell colSpan={5}><QueryErrorState resourceLabel="as mensagens" error={messagesQueryError} onRetry={() => { void refetchMessages(); }} compact /></TableCell></TableRow>
                ) : filteredMessages.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-10 text-muted-foreground"
                    >
                      <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>Nenhuma mensagem encontrada.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMessages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.clientName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={channelColors[m.channel] ?? ""}
                          variant="secondary"
                        >
                          {CHANNELS.find((c) => c.value === m.channel)?.label ??
                            m.channel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm max-w-xs truncate">{m.content}</p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          {statusIcons[m.status] ?? null}
                          {statusLabels[m.status] ?? m.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(m.sentAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          {loadingTemplates ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : templatesError ? (
            <QueryErrorState resourceLabel="os templates" error={templatesQueryError} onRetry={() => { void refetchTemplates(); }} />
          ) : !templates || templates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Nenhum template criado.</p>
              <p className="text-sm mt-1">
                Crie templates para agilizar o envio de mensagens.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id} className="group">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-semibold pr-2">
                        {t.name}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge
                          className={channelColors[t.channel] ?? ""}
                          variant="secondary"
                        >
                          {CHANNELS.find((c) => c.value === t.channel)?.label ??
                            t.channel}
                        </Badge>
                        <button
                          onClick={() => openEdit(t)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {t.category && (
                      <p className="text-xs text-muted-foreground">{t.category}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {t.content}
                    </p>
                    {t.variables && t.variables.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.variables.map((v) => (
                          <span
                            key={v}
                            className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono"
                          >
                            {"{"}
                            {v}
                            {"}"}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="email-logs" className="mt-4">
          <div className="rounded-lg border bg-muted/20 p-3 mb-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Histórico multicanal</p>
                <p className="text-xs text-muted-foreground">Uma linha representa a mensagem; expanda para ver cada entrega.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { void refetchOutboundMessages(); }} disabled={loadingOutboundMessages || historyExporting !== null}>
                  <RefreshCcw className={`w-4 h-4 mr-2 ${loadingOutboundMessages ? "animate-spin" : ""}`} /> Atualizar
                </Button>
                {(["csv", "pdf"] as const).map((format) => (
                  <Button
                    key={format}
                    variant="outline"
                    size="sm"
                    onClick={() => { void exportOutboundHistory(format); }}
                    disabled={historyExporting !== null}
                  >
                    {historyExporting === format
                      ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
                      : <Download className="w-4 h-4 mr-2" />}
                    {format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} aria-label="Data inicial" />
              <Input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} aria-label="Data final" />
              <Select value={historyClientId} onValueChange={setHistoryClientId}>
                <SelectTrigger><SelectValue placeholder="Cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os clientes</SelectItem>
                  {(clients?.data ?? []).map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={historyChannel} onValueChange={(v) => setHistoryChannel(v as "all" | "email" | "whatsapp")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
              <Select value={historyDeliveryStatus} onValueChange={(value) => setHistoryDeliveryStatus(value as OutboundDeliveryFilterStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as entregas</SelectItem>
                  {Object.entries(outboundDeliveryStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={historyBounceType} onValueChange={(value) => setHistoryBounceType(value as BounceTypeFilter)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os bounces</SelectItem>
                  <SelectItem value="permanent">Bounces permanentes</SelectItem>
                  <SelectItem value="temporary">Falhas temporárias</SelectItem>
                </SelectContent>
              </Select>
              <Select value={historyProvider} onValueChange={setHistoryProvider}>
                <SelectTrigger><SelectValue placeholder="Provedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os provedores</SelectItem>
                  {uniqueHistoryProviders.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}
                  {hasUnknownHistoryProvider && (
                    <SelectItem value={UNKNOWN_PROVIDER_FILTER}>Provedor não identificado</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select value={historyStatus} onValueChange={setHistoryStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {Object.entries(outboundStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
                <Select value={historyOrigin} onValueChange={setHistoryOrigin}>
                <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as origens</SelectItem>
                  {uniqueHistoryOrigins.map((origin) => <SelectItem key={origin} value={origin}>{origin}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={historyCampaignId} onChange={(e) => setHistoryCampaignId(e.target.value)} placeholder="ID da campanha" aria-label="ID da campanha" />
              <Input value={historyAutomationId} onChange={(e) => setHistoryAutomationId(e.target.value)} placeholder="ID da automação" aria-label="ID da automação" />
              <Button variant="ghost" onClick={() => {
                setHistoryDateFrom(""); setHistoryDateTo(""); setHistoryClientId("all");
                setHistoryChannel("all"); setHistoryStatus("all"); setHistoryDeliveryStatus("all"); setHistoryBounceType("all"); setHistoryProvider("all"); setHistoryOrigin("all");
                setHistoryCampaignId(""); setHistoryAutomationId("");
              }}>Limpar filtros</Button>
            </div>
            {failedDeliveryCount > 0 && (
              <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <p className="text-sm">
                  <strong>{failedDeliveryCount}</strong> {failedDeliveryCount === 1 ? "entrega foi rejeitada" : "entregas foram rejeitadas"} pelo provedor.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto border-red-300 bg-white text-red-800 hover:bg-red-100"
                  onClick={() => setHistoryDeliveryStatus("failed")}
                >
                  Ver falhas
                </Button>
              </div>
            )}
            {(bounceTypeCounts.permanent > 0 || bounceTypeCounts.temporary > 0) && (
              <div className="flex items-center gap-2 flex-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-800">Classificação das falhas:</span>
                {(["permanent", "temporary"] as const).map((bounceType) => (
                  <Button
                    key={bounceType}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={historyBounceType === bounceType ? "border-slate-500 bg-white" : "bg-white"}
                    onClick={() => openBounceType(bounceType)}
                  >
                    {bounceTypeLabels[bounceType]} ({bounceTypeCounts[bounceType]})
                  </Button>
                ))}
              </div>
            )}
            <Card className="border-red-100 bg-red-50/40">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">Falhas por provedor</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Participação de cada provedor nas entregas rejeitadas pelos filtros atuais.
                    </p>
                  </div>
                  {providerFailureSummary && providerFailureSummary.length > 0 && (
                    <Badge variant="outline" className="border-red-200 bg-white text-red-800">
                      {providerFailureSummary[0].totalFailures} falhas
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingProviderFailureSummary ? (
                  <div className="grid gap-2 md:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
                  </div>
                ) : providerFailureSummaryError ? (
                  <p className="text-sm text-muted-foreground">Não foi possível carregar o resumo por provedor.</p>
                ) : providerFailureSummary?.length ? (
                  <div className="grid gap-2 md:grid-cols-3">
                    {providerFailureSummary.map((item: OutboundProviderFailureSummary) => (
                      <button
                        key={item.provider ?? "unknown"}
                        type="button"
                        className="rounded-md border bg-white p-3 text-left transition-colors hover:border-red-300 hover:bg-red-50"
                        onClick={() => openProviderFailures(item.provider)}
                        title="Abrir as entregas deste indicador"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{item.provider ?? "Provedor não identificado"}</span>
                          <span className="text-lg font-semibold text-red-700">{item.failureCount}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{item.failurePercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% das falhas</span>
                          <span className="text-red-700">Ver entregas →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma falha de entrega nos filtros atuais.</p>
                )}
              </CardContent>
            </Card>
          </div>
          {loadingOutboundMessages ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : outboundMessagesError ? (
            <QueryErrorState resourceLabel="o histórico multicanal" error={outboundMessagesQueryError} onRetry={() => { void refetchOutboundMessages(); }} />
          ) : filteredOutboundMessages.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>Nenhum evento encontrado com esses filtros.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredOutboundMessages.map((message: OutboundMessage) => (
                <div key={message.id} className="rounded-lg border bg-card overflow-hidden">
                  <button className="w-full text-left p-3 hover:bg-muted/30" onClick={() => setExpandedHistoryId(expandedHistoryId === message.id ? null : message.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{message.eventType}</Badge>
                      <Badge className={message.status === "partial" ? "bg-orange-100 text-orange-800" : message.status === "failed" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>{message.status === "partial" ? "Falha parcial" : message.status === "accepted" ? "Aceito" : statusLabels[message.status] ?? message.status}</Badge>
                      <span className="text-sm font-medium">{message.recipientName ?? message.recipientId ?? "Destinatário não identificado"}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(message.createdAt).toLocaleString("pt-BR")}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Origem: {message.origin}{message.originChannel ? ` · iniciado por ${message.originChannel === "email" ? "E-mail" : "WhatsApp"}` : ""} · {message.deliveries.length} entrega(s)</p>
                  </button>
                  {expandedHistoryId === message.id && (
                    <div className="border-t bg-muted/10 divide-y">
                      {message.deliveries.map((delivery) => (
                        <div key={delivery.id} className="p-3 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={channelColors[delivery.channel]}>{delivery.channel === "email" ? "E-mail" : "WhatsApp"}</Badge>
                            <Badge
                              variant="outline"
                              className={delivery.status === "failed" ? "border-red-300 bg-red-100 text-red-800" : delivery.status === "skipped" ? "border-amber-300 bg-amber-100 text-amber-800" : ""}
                            >
                              {delivery.status === "accepted" ? "Aceito" : delivery.status === "skipped" ? "Ignorado" : delivery.status === "failed" ? "Falhou" : delivery.status === "processing" ? "Processando" : "Pendente"}
                            </Badge>
                            {delivery.bounceType && (
                              <Badge
                                variant="outline"
                                className={delivery.bounceType === "permanent" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-800"}
                              >
                                {bounceTypeLabels[delivery.bounceType]}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {delivery.attempts} tentativa(s) · {delivery.recipient ?? "sem contato"}
                              {delivery.provider ? ` · ${delivery.provider}` : ""}
                            </span>
                            {(delivery.status === "failed" || (delivery.status === "skipped" && delivery.skippedReason === "provider_unavailable")) && (
                              <Button size="sm" variant="outline" className="ml-auto" onClick={() => { void handleRetryDelivery(delivery); }} disabled={retryOutboundDelivery.isPending}>
                                <RefreshCcw className="w-3.5 h-3.5 mr-1" /> Retry só deste canal
                              </Button>
                            )}
                          </div>
                          {delivery.subject && <p className="text-xs"><strong>Assunto:</strong> {delivery.subject}</p>}
                          {delivery.lastError && <p className="text-xs text-red-700"><strong>Erro:</strong> {delivery.lastError}</p>}
                          {delivery.skippedReason && <p className="text-xs text-amber-700"><strong>Motivo ignorado:</strong> {delivery.skippedReason.replaceAll("_", " ")}</p>}
                          {delivery.externalId && <p className="text-xs text-muted-foreground"><strong>ID externo:</strong> {delivery.externalId}</p>}
                          {delivery.attemptHistory?.[0] && <div className="text-xs text-muted-foreground">Última tentativa: {new Date(delivery.attemptHistory[0].startedAt).toLocaleString("pt-BR")}{delivery.attemptHistory[0].error ? ` · ${delivery.attemptHistory[0].error}` : ""}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="failed-emails" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Reservas cujos e-mails de confirmação esgotaram todas as tentativas automáticas e ainda não foram reenviados com sucesso.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchFailedSummary} disabled={loadingFailedSummary}>
              <RefreshCcw className={`w-4 h-4 mr-2 ${loadingFailedSummary ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
          {loadingFailedSummary ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : failedSummaryError ? (
            <div className="text-center py-16 text-muted-foreground">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-400" />
              <p className="font-medium text-red-700">{failedSummaryError}</p>
            </div>
          ) : failedSummary.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Nenhum e-mail com falha pendente.</p>
              <p className="text-xs mt-1">Todos os e-mails de confirmação foram entregues com sucesso.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <p className="text-sm text-red-700">
                  {failedSummary.length} reserva(s) com e-mail de confirmação não entregue. Use o botão "Reenviar" para tentar novamente.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reserva</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>E-mail do cliente</TableHead>
                    <TableHead>Esgotado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failedSummary.map((item) => (
                    <TableRow key={item.reservationId}>
                      <TableCell className="font-mono text-sm font-medium">
                        #{item.reservationNumber ?? item.reservationId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-sm">{item.clientName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.clientEmail ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(item.exhaustedAt).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.emailLogId ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleResendFailed(item.emailLogId!)}
                            disabled={resendingId === item.emailLogId}
                          >
                            <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${resendingId === item.emailLogId ? "animate-spin" : ""}`} />
                            Reenviar
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem log disponível</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
