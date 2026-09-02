import { useState, useEffect } from "react";
import {
  useListAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useToggleAutomation,
  useDeleteAutomation,
  useListAutomationActions,
  useCreateAutomationAction,
  useDeleteAutomationAction,
  useListAutomationLogs,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ListLoadError } from "@/components/list-load-error";
import { QueryErrorState } from "@/components/query-error-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Zap,
  Trash2,
  PlayCircle,
  ChevronRight,
  Settings2,
  ScrollText,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Save,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { interpolateWhatsAppPreview, renderWhatsAppPreview } from "@/lib/whatsappPreview";
import type { Automation } from "@workspace/api-client-react";

const triggerLabels: Record<string, string> = {
  new_client: "Novo Cliente Cadastrado",
  payment_pending: "Pagamento Pendente",
  birthday: "Aniversário do Cliente",
  reservation_created: "Reserva Criada",
  pipeline_stage_changed: "Mudança de Estágio no Pipeline",
  trip_approaching: "Viagem se Aproximando",
  post_trip: "Pós-Viagem",
  nps_request: "Pesquisa NPS",
  payment_received: "Pagamento Recebido",
  trip_departure: "Saída de Viagem",
  checkin: "Check-in Realizado",
  trip_completed: "Viagem Concluída",
};

const actionTypeLabels: Record<string, string> = {
  send_whatsapp: "Enviar WhatsApp",
  send_email: "Enviar E-mail",
  send_unified: "Enviar E-mail + WhatsApp",
  change_pipeline_stage: "Alterar Estágio Pipeline",
  add_tag: "Adicionar Tag",
  create_task: "Criar Tarefa",
  send_sms: "Enviar SMS",
};

const logStatusConfig: Record<string, { label: string; icon: React.ReactNode; className: string }> =
  {
    success: {
      label: "Sucesso",
      icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
      className: "text-green-700 bg-green-50",
    },
    failed: {
      label: "Falhou",
      icon: <XCircle className="w-4 h-4 text-red-500" />,
      className: "text-red-700 bg-red-50",
    },
    running: {
      label: "Executando",
      icon: <Clock className="w-4 h-4 text-yellow-500" />,
      className: "text-yellow-700 bg-yellow-50",
    },
  };

type Condition = { field: string; operator: string; value: string };

const conditionFields = [
  { value: "client.tag", label: "Tag do cliente" },
  { value: "client.city", label: "Cidade do cliente" },
  { value: "trip.name", label: "Nome da viagem" },
  { value: "payment.status", label: "Status do pagamento" },
  { value: "pipeline.stage", label: "Estágio do Pipeline" },
  { value: "days_before_trip", label: "Dias antes da viagem" },
];

const conditionOperators = [
  { value: "equals", label: "é igual a" },
  { value: "not_equals", label: "é diferente de" },
  { value: "contains", label: "contém" },
  { value: "greater_than", label: "maior que" },
  { value: "less_than", label: "menor que" },
];

function AutomationDetail({
  automation,
  onClose,
  onUpdated,
}: {
  automation: Automation;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [actionType, setActionType] = useState("send_whatsapp");
  const [actionConfig, setActionConfig] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [whatsappContent, setWhatsappContent] = useState("");
  const storedConditions =
    automation.triggerConfig &&
    typeof automation.triggerConfig === "object" &&
    "conditions" in automation.triggerConfig &&
    Array.isArray((automation.triggerConfig as Record<string, unknown>).conditions)
      ? ((automation.triggerConfig as Record<string, unknown>).conditions as Condition[])
      : [];
  const [conditions, setConditions] = useState<Condition[]>(storedConditions);
  const [condField, setCondField] = useState("client.tag");
  const [condOp, setCondOp] = useState("equals");
  const [condVal, setCondVal] = useState("");

  const { data: allActions, isError: actionsError, error: actionsQueryError, refetch: refetchActions } = useListAutomationActions();
  const { data: allLogs, isError: logsError, error: logsQueryError, refetch: refetchLogs } = useListAutomationLogs();

  const actions = (allActions ?? []).filter(
    (a) => a.automationId === automation.id
  );
  const logs = (allLogs ?? []).filter(
    (l) => l.automationId === automation.id
  );

  const createAction = useCreateAutomationAction();
  const deleteAction = useDeleteAutomationAction();
  const updateAutomation = useUpdateAutomation();

  const handleAddAction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await createAction.mutateAsync({
      data: {
        automationId: automation.id,
        type: actionType,
        config: actionType === "send_unified"
          ? { email: { subject: emailSubject, html: emailContent }, whatsapp: { text: whatsappContent } }
          : actionConfig ? { message: actionConfig } : {},
        order: (actions ?? []).length + 1,
      },
    });
    setActionConfig("");
    setEmailSubject("");
    setEmailContent("");
    setWhatsappContent("");
    refetchActions();
  };

  const handleDeleteAction = async (id: string) => {
    await deleteAction.mutateAsync({ id });
    refetchActions();
  };

  const saveConditions = (newConds: Condition[]) => {
    const existingConfig =
      automation.triggerConfig && typeof automation.triggerConfig === "object"
        ? (automation.triggerConfig as Record<string, unknown>)
        : {};
    updateAutomation.mutateAsync({
      id: automation.id,
      data: {
        triggerConfig: { ...existingConfig, conditions: newConds },
      },
    }).then(onUpdated);
  };

  const handleAddCondition = () => {
    if (!condVal.trim()) return;
    const newConds = [
      ...conditions,
      { field: condField, operator: condOp, value: condVal.trim() },
    ];
    setConditions(newConds);
    setCondVal("");
    saveConditions(newConds);
  };

  const handleRemoveCondition = (idx: number) => {
    const newConds = conditions.filter((_, i) => i !== idx);
    setConditions(newConds);
    saveConditions(newConds);
  };

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          {automation.name}
        </DialogTitle>
      </DialogHeader>
      <Tabs defaultValue="actions">
        <TabsList className="mb-4">
          <TabsTrigger value="actions">
            <Settings2 className="w-4 h-4 mr-1.5" /> Ações
          </TabsTrigger>
          <TabsTrigger value="conditions">
            <ChevronRight className="w-4 h-4 mr-1.5" /> Condições
          </TabsTrigger>
          <TabsTrigger value="logs">
            <ScrollText className="w-4 h-4 mr-1.5" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-4">
          {actionsError ? (
            <QueryErrorState resourceLabel="as ações da automação" error={actionsQueryError} onRetry={() => { void refetchActions(); }} compact />
          ) : (
          <>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium">Gatilho:</span>
            <span className="text-sm text-muted-foreground">
              {triggerLabels[automation.triggerType] ?? automation.triggerType}
            </span>
          </div>

          {(actions ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Sequência de ações</p>
              {(actions ?? []).map((a, i) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                >
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {actionTypeLabels[a.type] ?? a.type}
                    </p>
                    {a.config && typeof a.config === "object" && "message" in a.config && (
                      <p className="text-xs text-muted-foreground truncate">
                        {String(a.config.message)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteAction(a.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddAction} className="space-y-3 pt-2 border-t">
            <p className="text-sm font-medium">Adicionar Ação</p>
            <div className="grid grid-cols-2 gap-3">
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(actionTypeLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={actionConfig}
                onChange={(e) => setActionConfig(e.target.value)}
                placeholder="Conteúdo / valor"
              />
            </div>
            {actionType === "send_unified" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Conteúdo do E-mail</Label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Assunto" required />
                  <Textarea value={emailContent} onChange={(e) => setEmailContent(e.target.value)} placeholder="HTML/texto do e-mail" required />
                </div>
                <div className="space-y-2">
                  <Label>Conteúdo do WhatsApp</Label>
                  <Textarea value={whatsappContent} onChange={(e) => setWhatsappContent(e.target.value)} placeholder="Texto do WhatsApp" required />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Fechar
              </Button>
              <Button type="submit" size="sm" disabled={createAction.isPending}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                {createAction.isPending ? "Adicionando..." : "Adicionar Ação"}
              </Button>
            </div>
          </form>
          </>
          )}
        </TabsContent>

        <TabsContent value="conditions" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Condições adicionais para controlar quando esta automação será disparada.
            Deixe em branco para disparar sempre que o gatilho ocorrer.
          </p>

          {conditions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Condições configuradas</p>
              {conditions.map((cond, idx) => {
                const fieldLabel = conditionFields.find((f) => f.value === cond.field)?.label ?? cond.field;
                const opLabel = conditionOperators.find((o) => o.value === cond.operator)?.label ?? cond.operator;
                return (
                  <div key={idx} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
                    <div className="flex-1 text-sm">
                      <span className="font-medium">{fieldLabel}</span>{" "}
                      <span className="text-muted-foreground">{opLabel}</span>{" "}
                      <span className="font-medium text-primary">"{cond.value}"</span>
                    </div>
                    <button
                      onClick={() => handleRemoveCondition(idx)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 border rounded-lg bg-muted/20 text-muted-foreground text-sm">
              Nenhuma condição adicional configurada — a automação dispara sempre que o gatilho ocorrer.
            </div>
          )}

          <div className="space-y-3 pt-2 border-t">
            <p className="text-sm font-medium">Adicionar Condição</p>
            <div className="grid grid-cols-3 gap-2">
              <Select value={condField} onValueChange={setCondField}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conditionFields.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={condOp} onValueChange={setCondOp}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conditionOperators.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={condVal}
                onChange={(e) => setCondVal(e.target.value)}
                placeholder="Valor"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Fechar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleAddCondition}
                disabled={!condVal.trim() || updateAutomation.isPending}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Adicionar Condição
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="logs">
          {logsError ? (
            <QueryErrorState resourceLabel="o histórico da automação" error={logsQueryError} onRetry={() => { void refetchLogs(); }} compact />
          ) : !logs || (logs ?? []).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma execução registrada ainda.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Executado em</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs ?? []).map((log) => {
                  const st = logStatusConfig[log.status] ?? {
                    label: log.status,
                    icon: null,
                    className: "",
                  };
                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        <span
                          className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full w-fit ${st.className}`}
                        >
                          {st.icon}
                          {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(log.executedAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-sm text-red-500 max-w-xs truncate">
                        {log.errorMessage ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

/* ──────────────────── WhatsApp Notifications Tab ──────────────────── */

const WA_DEFAULT_MSGS = {
  cadastroRealizado:
    "👋 Olá, {nome}! Seu cadastro na viagem *{viagem}* foi realizado com sucesso. Referência: *{referencia}*. Em breve entraremos em contato. {agencia}",
  reservationConfirmed:
    "✅ Olá, {nome}! Sua reserva na viagem *{viagem}* foi confirmada. Partida em *{data}*. Referência: *{referencia}*. Qualquer dúvida, fale com {agencia}.",
  paymentReceived:
    "✅ Pagamento recebido! Olá, {nome}. Confirmamos *R$ {valor}*. Saldo restante: *R$ {saldo_restante}*. Obrigado! {agencia}",
  pagamentoPendente:
    "💰 Olá, {nome}! Sua viagem *{viagem}* parte em breve (*{data}*) e ainda há um saldo pendente de *R$ {saldo_restante}*. Regularize para garantir sua vaga. {agencia}",
  boardingReminder:
    "🚌 Olá, {nome}! Lembrete: sua viagem para *{viagem}* está marcada para *{data}*. Local de embarque: *{local_saida}* — {horario}. Boa viagem! {agencia}",
};

interface WaSettings {
  reservationConfirmed: boolean;
  reservationConfirmedMessage?: string | null;
  paymentReceived: boolean;
  paymentReceivedMessage?: string | null;
  boardingReminder: boolean;
  boardingReminderMessage?: string | null;
  boardingReminderDaysBeforeTrip?: number[];
  cadastroRealizado: boolean;
  cadastroRealizadoMessage?: string | null;
  pagamentoPendente: boolean;
  pagamentoPendenteMessage?: string | null;
  pagamentoPendenteDaysBeforeTrip?: number;
}

const WA_TYPES = [
  {
    key: "cadastroRealizado" as const,
    msgKey: "cadastroRealizadoMessage" as const,
    label: "Cadastro realizado",
    hint: "Disparada quando uma nova reserva é criada (status pendente).",
    vars: ["{nome}", "{viagem}", "{referencia}", "{agencia}"],
    defaultMsg: WA_DEFAULT_MSGS.cadastroRealizado,
  },
  {
    key: "reservationConfirmed" as const,
    msgKey: "reservationConfirmedMessage" as const,
    label: "Reserva confirmada",
    hint: "Disparada quando uma reserva é confirmada.",
    vars: ["{nome}", "{viagem}", "{data}", "{referencia}", "{agencia}"],
    defaultMsg: WA_DEFAULT_MSGS.reservationConfirmed,
  },
  {
    key: "paymentReceived" as const,
    msgKey: "paymentReceivedMessage" as const,
    label: "Pagamento recebido",
    hint: "Disparada quando um pagamento é registrado.",
    vars: ["{nome}", "{valor}", "{saldo_restante}", "{agencia}"],
    defaultMsg: WA_DEFAULT_MSGS.paymentReceived,
  },
  {
    key: "pagamentoPendente" as const,
    msgKey: "pagamentoPendenteMessage" as const,
    label: "Saldo pendente antes da viagem",
    hint: "Lembrete enviado N dias antes da viagem quando há saldo em aberto.",
    vars: ["{nome}", "{viagem}", "{data}", "{saldo_restante}", "{agencia}"],
    defaultMsg: WA_DEFAULT_MSGS.pagamentoPendente,
  },
  {
    key: "boardingReminder" as const,
    msgKey: "boardingReminderMessage" as const,
    label: "Lembrete de embarque",
    hint: "Enviada N dias antes do embarque.",
    vars: ["{nome}", "{viagem}", "{data}", "{local_saida}", "{horario}", "{agencia}"],
    defaultMsg: WA_DEFAULT_MSGS.boardingReminder,
  },
] as const;

const BASE_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL ?? "";

function WhatsAppNotificationsTab() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<WaSettings>({
    reservationConfirmed: true,
    paymentReceived: true,
    boardingReminder: true,
    cadastroRealizado: false,
    pagamentoPendente: false,
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/whatsapp-notifications/settings`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setSettings(data); })
      .catch(() => {});
  }, []);

  function update(patch: Partial<WaSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/whatsapp-notifications/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error("Erro ao salvar");
      const saved = await r.json();
      setSettings(saved);
      setDirty(false);
      toast({ title: "Configurações de WhatsApp salvas!" });
    } catch {
      toast({ title: "Erro ao salvar configurações", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold">Notificações automáticas por WhatsApp</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Mensagens enviadas automaticamente para os clientes via WhatsApp quando eventos importantes acontecem.
          Requer WhatsApp configurado em <strong>Configurações → Integrações</strong>.
        </p>
      </div>

      <div className="space-y-0 divide-y rounded-lg border bg-card">
        {WA_TYPES.map((t) => (
          <div key={t.key} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{t.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{t.hint}</p>
              </div>
              <Switch
                checked={settings[t.key] ?? false}
                onCheckedChange={(v) => update({ [t.key]: v })}
              />
            </div>

            {settings[t.key] && (
              <div className="space-y-2 pl-0">
                {/* Timing controls */}
                {t.key === "pagamentoPendente" && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground shrink-0">
                      Dias antes da viagem (1–30):
                    </Label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="w-20 border rounded px-2 py-1 text-sm bg-background"
                      value={settings.pagamentoPendenteDaysBeforeTrip ?? 7}
                      onChange={(e) =>
                        update({
                          pagamentoPendenteDaysBeforeTrip: Math.min(30, Math.max(1, parseInt(e.target.value) || 7)),
                        })
                      }
                    />
                  </div>
                )}
                {t.key === "boardingReminder" && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground shrink-0">
                        Dias antes do embarque (1–14, ex: 1, 3, 7):
                      </Label>
                      <input
                        type="text"
                        className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                        placeholder="1"
                        value={(settings.boardingReminderDaysBeforeTrip ?? [1]).join(", ")}
                        onChange={(e) => {
                          const days = e.target.value
                            .split(",")
                            .map((v) => parseInt(v.trim()))
                            .filter((n) => !isNaN(n) && n >= 1 && n <= 14);
                          update({ boardingReminderDaysBeforeTrip: days.length > 0 ? days : [1] });
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Máximo 14 dias de antecedência.</p>
                  </div>
                )}

                {/* Variable chips */}
                <div className="flex flex-wrap gap-1.5">
                  {t.vars.map((v) => (
                    <span
                      key={v}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground border select-all cursor-default"
                    >
                      {v}
                    </span>
                  ))}
                </div>

                {/* Message textarea */}
                <Textarea
                  rows={3}
                  placeholder={t.defaultMsg}
                  value={settings[t.msgKey] ?? ""}
                  onChange={(e) => update({ [t.msgKey]: e.target.value || null })}
                  className="text-sm resize-none font-mono"
                />
                 <div className="space-y-1.5" aria-label={`Pré-visualização de ${t.label}`}>
                   <p className="text-xs font-medium text-muted-foreground">Pré-visualização</p>
                   <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm leading-relaxed text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-50">
                     {renderWhatsAppPreview(
                       interpolateWhatsAppPreview(settings[t.msgKey] || t.defaultMsg),
                     )}
                   </div>
                   <p className="text-[11px] text-muted-foreground">
                     Exemplo com dados de um passageiro. A mensagem acima é atualizada enquanto você digita.
                   </p>
                 </div>
                {settings[t.msgKey] && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => update({ [t.msgKey]: null })}
                  >
                    Usar mensagem padrão
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Button onClick={handleSave} disabled={saving || !dirty}>
        {saving ? (
          <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</>
        ) : (
          <><Save className="h-4 w-4 mr-2" />Salvar configurações</>
        )}
      </Button>
    </div>
  );
}

export default function Automations() {
  const [isOpen, setIsOpen] = useState(false);
  const [detailAutomation, setDetailAutomation] = useState<Automation | null>(null);
  const [triggerType, setTriggerType] = useState("reservation_created");

  const { data: automations, isLoading, isError, refetch } = useListAutomations();
  const createAutomation = useCreateAutomation();
  const toggleAutomation = useToggleAutomation();
  const deleteAutomation = useDeleteAutomation();

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createAutomation.mutateAsync({
      data: {
        name: fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        triggerType,
        triggerConfig: {},
      },
    });
    setIsOpen(false);
    setTriggerType("reservation_created");
    refetch();
  };

  const handleToggle = async (id: string) => {
    await toggleAutomation.mutateAsync({ id });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await deleteAutomation.mutateAsync({ id });
    refetch();
  };

  const activeCount = (automations ?? []).filter((a) => a.isActive).length;
  const totalExecutions = (automations ?? []).reduce(
    (s, a) => s + a.executionsCount,
    0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Automações</h1>
        <p className="text-muted-foreground mt-1">
          Configure regras automáticas e notificações para economizar tempo no dia a dia.
        </p>
      </div>

      <Tabs defaultValue="automacoes">
        <TabsList>
          <TabsTrigger value="automacoes">
            <Zap className="w-4 h-4 mr-1.5" /> Automações
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageSquare className="w-4 h-4 mr-1.5" /> Notificações WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="automacoes" className="space-y-6 mt-6">
          <div className="flex items-center justify-end">
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Nova Automação
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Criar Automação</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome</label>
                    <Input
                      name="name"
                      required
                      placeholder="Ex: Confirmação de reserva via WhatsApp"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Gatilho (Trigger)</label>
                    <Select value={triggerType} onValueChange={setTriggerType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(triggerLabels).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Descrição (opcional)</label>
                    <Textarea
                      name="description"
                      rows={3}
                      placeholder="O que essa automação faz?"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={createAutomation.isPending}>
                      {createAutomation.isPending ? "Criando..." : "Criar Automação"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-xl font-bold">{(automations ?? []).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 text-green-700">
                    <PlayCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ativas</p>
                    <p className="text-xl font-bold">{activeCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 text-purple-700">
                    <ScrollText className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Execuções</p>
                    <p className="text-xl font-bold">{totalExecutions}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : isError ? (
            <ListLoadError
              onRetry={refetch}
              message="Não foi possível carregar as automações."
              className="rounded-lg border bg-card"
            />
          ) : !automations || automations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border rounded-lg bg-card">
              <Zap className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Nenhuma automação configurada</p>
              <p className="text-sm mt-1">
                Crie automações para automatizar comunicações com clientes.
              </p>
            </div>
          ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {automations.map((a) => (
            <Card key={a.id} className={a.isActive ? "" : "opacity-60"}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{a.name}</CardTitle>
                    {a.description && (
                      <CardDescription className="mt-0.5 line-clamp-1">
                        {a.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={a.isActive}
                      onCheckedChange={() => handleToggle(a.id)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Zap className="w-3 h-3 mr-1" />
                      {triggerLabels[a.triggerType] ?? a.triggerType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {a.executionsCount} execuções
                    </span>
                    {a.lastExecutedAt && (
                      <span className="text-xs text-muted-foreground">
                        Última:{" "}
                        {new Date(a.lastExecutedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Dialog
                      open={detailAutomation?.id === a.id}
                      onOpenChange={(o) => !o && setDetailAutomation(null)}
                    >
                      <DialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailAutomation(a)}
                        >
                          <Settings2 className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      {detailAutomation?.id === a.id && (
                        <AutomationDetail
                          automation={a}
                          onClose={() => setDetailAutomation(null)}
                          onUpdated={() => refetch()}
                        />
                      )}
                    </Dialog>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(a.id)}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          </div>
        )}
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-6">
          <WhatsAppNotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
