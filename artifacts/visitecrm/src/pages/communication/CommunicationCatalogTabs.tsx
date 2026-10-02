import { MessageSquare, Pencil, Trash2, WholeWord } from "lucide-react";
import type { Message, MessageTemplate } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryErrorState } from "@/components/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "sms", label: "SMS" },
  { value: "instagram", label: "Instagram" },
  { value: "telegram", label: "Telegram" },
  { value: "internal", label: "Interno" },
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

export function MessagesTab({
  filterChannel,
  onFilterChange,
  messages,
  loading,
  error,
  queryError,
  onRetry,
  channelColors,
}: {
  filterChannel: string;
  onFilterChange: (channel: string) => void;
  messages: Message[];
  loading: boolean;
  error: boolean;
  queryError: unknown;
  onRetry: () => unknown;
  channelColors: Record<string, string>;
}) {
  const filteredMessages = filterChannel === "all"
    ? messages
    : messages.filter((message) => message.channel === filterChannel);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Filtrar:</span>
        {["all", ...CHANNELS.map((channel) => channel.value)].map((channel) => (
          <button
            key={channel}
            data-testid={`button-filter-message-${channel}`}
            onClick={() => onFilterChange(channel)}
            aria-pressed={filterChannel === channel}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filterChannel === channel
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {channel === "all" ? "Todos" : CHANNELS.find((item) => item.value === channel)?.label ?? channel}
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
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: 5 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}><Skeleton className="h-6 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <QueryErrorState resourceLabel="as mensagens" error={queryError} onRetry={() => { void onRetry(); }} compact />
                </TableCell>
              </TableRow>
            ) : filteredMessages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>Nenhuma mensagem encontrada.</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredMessages.map((message) => (
                <TableRow key={message.id}>
                  <TableCell className="font-medium">{message.clientName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={channelColors[message.channel] ?? ""} variant="secondary">
                      {CHANNELS.find((channel) => channel.value === message.channel)?.label ?? message.channel}
                    </Badge>
                  </TableCell>
                  <TableCell><p className="text-sm max-w-xs truncate">{message.content}</p></TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-sm">
                      {statusIcons[message.status] ?? null} {statusLabels[message.status] ?? message.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(message.sentAt).toLocaleString("pt-BR", {
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
    </div>
  );
}

export function TemplatesTab({
  templates,
  loading,
  error,
  queryError,
  onRetry,
  canManageTemplates,
  channelColors,
  onEdit,
  onDelete,
  extractTemplateVariables,
}: {
  templates: MessageTemplate[] | undefined;
  loading: boolean;
  error: boolean;
  queryError: unknown;
  onRetry: () => unknown;
  canManageTemplates: boolean;
  channelColors: Record<string, string>;
  onEdit: (template: MessageTemplate) => void;
  onDelete: (id: string) => void;
  extractTemplateVariables: (content: string) => string[];
}) {
  return loading ? (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-40 w-full" />)}
    </div>
  ) : error ? (
    <QueryErrorState resourceLabel="os templates" error={queryError} onRetry={() => { void onRetry(); }} />
  ) : !templates || templates.length === 0 ? (
    <div className="text-center py-16 text-muted-foreground">
      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
      <p className="font-medium">Nenhum template criado.</p>
      <p className="text-sm mt-1">Crie templates para agilizar o envio de mensagens.</p>
    </div>
  ) : (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {templates.map((template) => (
        <Card key={template.id} className="group">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <CardTitle className="text-sm font-semibold pr-2">{template.name}</CardTitle>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge className={channelColors[template.channel] ?? ""} variant="secondary">
                  {CHANNELS.find((channel) => channel.value === template.channel)?.label ?? template.channel}
                </Badge>
                {canManageTemplates && (
                  <>
                    <button
                      type="button"
                      aria-label={`Editar template ${template.name}`}
                      data-testid={`button-edit-template-${template.id}`}
                      onClick={() => onEdit(template)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir template ${template.name}`}
                      data-testid={`button-delete-template-${template.id}`}
                      onClick={() => onDelete(template.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {template.category && <p className="text-xs text-muted-foreground">{template.category}</p>}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-3">{template.content}</p>
            {extractTemplateVariables(template.content).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {extractTemplateVariables(template.content).map((variable) => (
                  <span key={variable} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {"{"}{variable}{"}"}
                  </span>
                ))}
              </div>
            )}
            {template.channel === "email" && template.subject && (
              <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                <WholeWord className="w-3.5 h-3.5" /> Assunto: {template.subject}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}