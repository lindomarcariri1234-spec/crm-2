import { useState, useMemo, useEffect, useCallback } from "react";
import {
  useListMessages,
  useSendMessage,
  useListMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { MessageTemplate, Message } from "@workspace/api-client-react";

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

export default function Communication() {
  const { toast } = useToast();
  const [tab, setTab] = useState("conversations");
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);

  const [sendChannel, setSendChannel] = useState("whatsapp");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [messageContent, setMessageContent] = useState("");
  const [tplChannel, setTplChannel] = useState("whatsapp");

  const [selectedConversationClientId, setSelectedConversationClientId] = useState<string | null>(null);
  const [inboxChannel, setInboxChannel] = useState("whatsapp");
  const [inboxMessage, setInboxMessage] = useState("");

  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [filterAutoRetry, setFilterAutoRetry] = useState<"all" | "auto" | "manual" | "exhausted" | "indicacoes">("all");

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
    try {
      const res = await fetch(`${BASE}/api/email-logs`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setEmailLogs(data ?? []);
      }
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

  const { data: messages, isLoading: loadingMessages, refetch: refetchMessages } =
    useListMessages({ limit: 50 });
  const { data: templates, isLoading: loadingTemplates, refetch: refetchTemplates } =
    useListMessageTemplates();
  const { data: clients } = useListClients({ limit: 200 });

  const sendMessage = useSendMessage();
  const createTemplate = useCreateMessageTemplate();
  const updateTemplate = useUpdateMessageTemplate();
  const deleteTemplate = useDeleteMessageTemplate();

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await sendMessage.mutateAsync({
      data: {
        toClientId: selectedClientId,
        channel: sendChannel,
        content: messageContent,
      },
    });
    setIsSendOpen(false);
    setSelectedClientId("");
    setSendChannel("whatsapp");
    setMessageContent("");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comunicação</h1>
          <p className="text-muted-foreground mt-1">
            Envie mensagens e gerencie templates omnicanal.
          </p>
        </div>
        <div className="flex gap-2">
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
                  <label className="text-sm font-medium">Canal</label>
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
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template (opcional)</label>
                  <Select
                    onValueChange={(id) => {
                      const tpl = (templates ?? []).find((x) => x.id === id);
                      if (tpl) setMessageContent(tpl.content);
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
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mensagem</label>
                  <Textarea
                    name="content"
                    required
                    rows={4}
                    placeholder="Digite sua mensagem..."
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                  />
                </div>
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
                    disabled={sendMessage.isPending || !selectedClientId}
                  >
                    {sendMessage.isPending ? "Enviando..." : "Enviar"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="conversations">Conversas</TabsTrigger>
          <TabsTrigger value="messages">Mensagens Enviadas</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="email-logs" className="flex items-center gap-1">
            <Mail className="w-3.5 h-3.5" /> Log de E-mails
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
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Histórico de e-mails transacionais enviados pelo sistema.
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                {(["all", "indicacoes", "auto", "manual", "exhausted"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterAutoRetry(f)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      filterAutoRetry === f
                        ? f === "exhausted"
                          ? "bg-orange-500 text-white border-orange-500"
                          : f === "indicacoes"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-primary text-primary-foreground border-primary"
                        : f === "exhausted"
                        ? "bg-background border-orange-300 text-orange-700 hover:bg-orange-50"
                        : f === "indicacoes"
                        ? "bg-background border-amber-300 text-amber-700 hover:bg-amber-50"
                        : "bg-background border-border hover:bg-muted"
                    }`}
                  >
                    {f === "all"
                      ? "Todos"
                      : f === "indicacoes"
                      ? "Indicações"
                      : f === "auto"
                      ? "Auto-reenviados"
                      : f === "manual"
                      ? "Manuais / Originais"
                      : (
                        <span className="inline-flex items-center gap-1.5">
                          Esgotadas
                          {exhaustedReservationIds.size > 0 && (
                            <span className={`inline-flex items-center justify-center rounded-full text-xs font-bold min-w-[1rem] h-4 px-1 ${
                              filterAutoRetry === "exhausted"
                                ? "bg-white text-orange-600"
                                : "bg-orange-500 text-white"
                            }`}>
                              {exhaustedReservationIds.size}
                            </span>
                          )}
                        </span>
                      )}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchEmailLogs} disabled={loadingEmailLogs}>
              <RefreshCcw className={`w-4 h-4 mr-2 ${loadingEmailLogs ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
          {loadingEmailLogs ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : emailLogs.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>Nenhum log de e-mail encontrado.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emailLogs
                  .filter((log) =>
                    filterAutoRetry === "all"
                      ? true
                      : filterAutoRetry === "indicacoes"
                      ? REFERRAL_EMAIL_RE.test(log.subject ?? "")
                      : filterAutoRetry === "auto"
                      ? log.isAutoRetry
                      : filterAutoRetry === "exhausted"
                      ? log.reservationId !== null && exhaustedReservationIds.has(log.reservationId)
                      : !log.isAutoRetry,
                  )
                  .map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm">{log.recipient}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {getEmailTypeLabel(log)}
                          </Badge>
                          {!log.reservationId && REFERRAL_EMAIL_RE.test(log.subject ?? "") && /vence em \d+ dia|⏰/.test(log.subject ?? "") && (
                            <Badge className="text-xs bg-amber-50 text-amber-700 border-amber-300" variant="outline">
                              <Clock className="w-3 h-3 mr-1" />
                              Aviso de expiração
                            </Badge>
                          )}
                          {log.isAutoRetry && (
                            <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200" variant="outline">
                              <RefreshCcw className="w-3 h-3 mr-1" />
                              Auto-reenviado
                            </Badge>
                          )}
                          {log.reservationId && exhaustedReservationIds.has(log.reservationId) && (
                            <Badge className="text-xs bg-orange-50 text-orange-700 border-orange-300" variant="outline">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Tentativas esgotadas
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {log.subject || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            log.status === "sent"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : log.status === "failed"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : log.status === "queued"
                              ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                              : "bg-gray-50 text-gray-700 border-gray-200"
                          }
                        >
                          {log.status === "sent" && <Check className="w-3 h-3 mr-1" />}
                          {log.status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                          {log.status === "queued" && <Clock className="w-3 h-3 mr-1" />}
                          {log.status === "sent" ? "Enviado" : log.status === "failed" ? "Falhou" : log.status === "queued" ? "Na fila" : log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {log.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResend(log.id)}
                            disabled={resendingId === log.id}
                            title={log.errorMessage ?? undefined}
                          >
                            <RefreshCcw className={`w-3.5 h-3.5 mr-1 ${resendingId === log.id ? "animate-spin" : ""}`} />
                            Reenviar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
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
