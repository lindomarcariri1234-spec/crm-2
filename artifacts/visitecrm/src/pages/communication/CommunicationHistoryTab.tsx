import {
  AlertTriangle,
  Download,
  MessageSquare,
  RefreshCcw,
} from "lucide-react";
import type {
  OutboundDelivery,
  OutboundMessage,
  OutboundProviderFailureSummary,
} from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryErrorState } from "@/components/query-error-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export interface CommunicationHistoryFilters {
  dateFrom: string;
  dateTo: string;
  clientId: string;
  channel: "all" | "email" | "whatsapp";
  deliveryStatus: string;
  bounceType: string;
  provider: string;
  status: string;
  origin: string;
  campaignId: string;
  automationId: string;
}

export interface CommunicationHistoryBounceCounts {
  permanent: number;
  temporary: number;
}

export function CommunicationHistoryTab({
  filters,
  onFilterChange,
  onClearFilters,
  clients,
  origins,
  providers,
  hasUnknownProvider,
  unknownProviderValue,
  messages,
  loading,
  fetching,
  error,
  errorDetail,
  hasMore,
  onRetry,
  onLoadMore,
  onRefresh,
  exporting,
  onExport,
  expandedMessageId,
  onToggleMessage,
  canManageTemplates,
  onReconcile,
  onRetryDelivery,
  retryingDelivery,
  failedDeliveryCount,
  bounceCounts,
  onOpenProviderFailures,
  onOpenBounceType,
  providerFailureSummary,
  loadingProviderFailureSummary,
  providerFailureSummaryError,
  channelColors,
  outboundStatusLabels,
  deliveryStatusLabels,
  bounceTypeLabels,
}: {
  filters: CommunicationHistoryFilters;
  onFilterChange: (key: keyof CommunicationHistoryFilters, value: string) => void;
  onClearFilters: () => void;
  clients: Client[];
  origins: string[];
  providers: string[];
  hasUnknownProvider: boolean;
  unknownProviderValue: string;
  messages: OutboundMessage[];
  loading: boolean;
  fetching: boolean;
  error: boolean;
  errorDetail: unknown;
  hasMore: boolean;
  onRetry: () => unknown;
  onLoadMore: () => void;
  onRefresh: () => void;
  exporting: "csv" | "pdf" | null;
  onExport: (format: "csv" | "pdf") => void;
  expandedMessageId: string | null;
  onToggleMessage: (messageId: string) => void;
  canManageTemplates: boolean;
  onReconcile: (delivery: OutboundDelivery) => void;
  onRetryDelivery: (delivery: OutboundDelivery) => void;
  retryingDelivery: boolean;
  failedDeliveryCount: number;
  bounceCounts: CommunicationHistoryBounceCounts;
  onOpenProviderFailures: (provider: string | null) => void;
  onOpenBounceType: (bounceType: "permanent" | "temporary") => void;
  providerFailureSummary: OutboundProviderFailureSummary[] | undefined;
  loadingProviderFailureSummary: boolean;
  providerFailureSummaryError: boolean;
  channelColors: Record<string, string>;
  outboundStatusLabels: Record<string, string>;
  deliveryStatusLabels: Record<string, string>;
  bounceTypeLabels: Record<string, string>;
}) {
  return (
    <>
      <div className="rounded-lg border bg-muted/20 p-3 mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Histórico multicanal</p>
            <p className="text-xs text-muted-foreground">Uma linha representa a mensagem; expanda para ver cada entrega.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button data-testid="button-refresh-outbound-history" variant="outline" size="sm" onClick={onRefresh} disabled={loading || exporting !== null}>
              <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            {(["csv", "pdf"] as const).map((format) => (
              <Button data-testid={`button-export-outbound-history-${format}`} key={format} variant="outline" size="sm" onClick={() => onExport(format)} disabled={exporting !== null}>
                {exporting === format
                  ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" />
                  : <Download className="w-4 h-4 mr-2" />}
                {format.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input data-testid="input-history-date-from" type="date" value={filters.dateFrom} onChange={(event) => onFilterChange("dateFrom", event.target.value)} aria-label="Data inicial" />
          <Input data-testid="input-history-date-to" type="date" value={filters.dateTo} onChange={(event) => onFilterChange("dateTo", event.target.value)} aria-label="Data final" />
          <Select value={filters.clientId} onValueChange={(value) => onFilterChange("clientId", value)}>
            <SelectTrigger data-testid="select-history-client"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.channel} onValueChange={(value) => onFilterChange("channel", value as CommunicationHistoryFilters["channel"])}>
            <SelectTrigger data-testid="select-history-channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os canais</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.deliveryStatus} onValueChange={(value) => onFilterChange("deliveryStatus", value)}>
            <SelectTrigger data-testid="select-history-delivery-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as entregas</SelectItem>
              {Object.entries(deliveryStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.bounceType} onValueChange={(value) => onFilterChange("bounceType", value)}>
            <SelectTrigger data-testid="select-history-bounce-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os bounces</SelectItem>
              <SelectItem value="permanent">Bounces permanentes</SelectItem>
              <SelectItem value="temporary">Falhas temporárias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.provider} onValueChange={(value) => onFilterChange("provider", value)}>
            <SelectTrigger data-testid="select-history-provider"><SelectValue placeholder="Provedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os provedores</SelectItem>
              {providers.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}
              {hasUnknownProvider && <SelectItem value={unknownProviderValue}>Provedor não identificado</SelectItem>}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(value) => onFilterChange("status", value)}>
            <SelectTrigger data-testid="select-history-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(outboundStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.origin} onValueChange={(value) => onFilterChange("origin", value)}>
            <SelectTrigger data-testid="select-history-origin"><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {origins.map((origin) => <SelectItem key={origin} value={origin}>{origin}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input data-testid="input-history-campaign-id" value={filters.campaignId} onChange={(event) => onFilterChange("campaignId", event.target.value)} placeholder="ID da campanha" aria-label="ID da campanha" />
          <Input data-testid="input-history-automation-id" value={filters.automationId} onChange={(event) => onFilterChange("automationId", event.target.value)} placeholder="ID da automação" aria-label="ID da automação" />
          <Button data-testid="button-clear-history-filters" variant="ghost" onClick={onClearFilters}>Limpar filtros</Button>
        </div>
        {failedDeliveryCount > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <p className="text-sm">
              <strong>{failedDeliveryCount}</strong> {failedDeliveryCount === 1 ? "entrega foi rejeitada" : "entregas foram rejeitadas"} pelo provedor.
            </p>
            <Button
              data-testid="button-filter-failed-outbound-deliveries"
              variant="outline"
              size="sm"
              className="ml-auto border-red-300 bg-white text-red-800 hover:bg-red-100"
              onClick={() => onFilterChange("deliveryStatus", "failed")}
            >
              Ver falhas
            </Button>
          </div>
        )}
        {(bounceCounts.permanent > 0 || bounceCounts.temporary > 0) && (
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-sm font-medium text-slate-800">Classificação das falhas:</span>
            {(["permanent", "temporary"] as const).map((bounceType) => (
              <Button
                data-testid={`button-filter-bounce-${bounceType}`}
                key={bounceType}
                type="button"
                variant="outline"
                size="sm"
                className={filters.bounceType === bounceType ? "border-slate-500 bg-white" : "bg-white"}
                onClick={() => onOpenBounceType(bounceType)}
              >
                {bounceTypeLabels[bounceType]} ({bounceCounts[bounceType]})
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
                {providerFailureSummary.map((item) => (
                  <button
                    data-testid={`button-open-provider-failures-${item.provider ?? "unknown"}`}
                    key={item.provider ?? "unknown"}
                    type="button"
                    className="rounded-md border bg-white p-3 text-left transition-colors hover:border-red-300 hover:bg-red-50"
                    onClick={() => onOpenProviderFailures(item.provider)}
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

      {loading && messages.length === 0 ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
      ) : error && messages.length === 0 ? (
        <QueryErrorState resourceLabel="o histórico multicanal" error={errorDetail} onRetry={() => { void onRetry(); }} />
      ) : messages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>Nenhum evento encontrado com esses filtros.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => (
            <div key={message.id} className="rounded-lg border bg-card overflow-hidden">
              <button
                className="w-full text-left p-3 hover:bg-muted/30"
                data-testid={`button-expand-outbound-message-${message.id}`}
                aria-expanded={expandedMessageId === message.id}
                onClick={() => onToggleMessage(message.id)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{message.eventType}</Badge>
                  <Badge className={message.status === "partial" ? "bg-orange-100 text-orange-800" : message.status === "failed" ? "bg-red-100 text-red-800" : message.status === "unknown" ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"}>
                    {message.status === "partial" ? "Falha parcial" : message.status === "accepted" ? "Aceito" : message.status === "unknown" ? "Resultado desconhecido" : outboundStatusLabels[message.status] ?? message.status}
                  </Badge>
                  <span className="text-sm font-medium">{message.recipientName ?? message.recipientId ?? "Destinatário não identificado"}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(message.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Origem: {message.origin}{message.originChannel ? ` · iniciado por ${message.originChannel === "email" ? "E-mail" : "WhatsApp"}` : ""} · {message.deliveries.length} entrega(s)
                </p>
              </button>
              {expandedMessageId === message.id && (
                <div className="border-t bg-muted/10 divide-y">
                  {message.deliveries.map((delivery) => (
                    <div key={delivery.id} className="p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={channelColors[delivery.channel]}>{delivery.channel === "email" ? "E-mail" : "WhatsApp"}</Badge>
                        <Badge
                          variant="outline"
                          className={delivery.status === "failed" ? "border-red-300 bg-red-100 text-red-800" : delivery.status === "skipped" ? "border-amber-300 bg-amber-100 text-amber-800" : delivery.status === "unknown" ? "border-purple-300 bg-purple-100 text-purple-800" : ""}
                        >
                          {deliveryStatusLabels[delivery.status] ?? delivery.status}
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
                          {delivery.attempts} tentativa(s) · {delivery.recipient ?? "sem contato"}{delivery.provider ? ` · ${delivery.provider}` : ""}
                        </span>
                        {delivery.status === "unknown" && canManageTemplates && (
                          <Button data-testid={`button-reconcile-delivery-${delivery.id}`} size="sm" variant="outline" className="ml-auto border-purple-300 text-purple-800 hover:bg-purple-50" onClick={() => onReconcile(delivery)}>
                            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Revisar com o provedor
                          </Button>
                        )}
                        {(delivery.status === "failed" || (delivery.status === "skipped" && delivery.skippedReason === "provider_unavailable")) && (
                          <Button data-testid={`button-retry-delivery-${delivery.id}`} size="sm" variant="outline" className="ml-auto" onClick={() => onRetryDelivery(delivery)} disabled={retryingDelivery}>
                            <RefreshCcw className="w-3.5 h-3.5 mr-1" /> Tentar novamente neste canal
                          </Button>
                        )}
                      </div>
                      {delivery.subject && <p className="text-xs"><strong>Assunto:</strong> {delivery.subject}</p>}
                      {delivery.lastError && <p className="text-xs text-red-700"><strong>Erro:</strong> {delivery.lastError}</p>}
                      {delivery.skippedReason && <p className="text-xs text-amber-700"><strong>Motivo ignorado:</strong> {delivery.skippedReason.replaceAll("_", " ")}</p>}
                      {delivery.externalId && <p className="text-xs text-muted-foreground"><strong>ID externo:</strong> {delivery.externalId}</p>}
                      {delivery.attemptHistory?.[0] && (
                        <div className="text-xs text-muted-foreground">
                          Última tentativa: {new Date(delivery.attemptHistory[0].startedAt).toLocaleString("pt-BR")}
                          {delivery.attemptHistory[0].error ? ` · ${delivery.attemptHistory[0].error}` : ""}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && messages.length > 0 && (
        <QueryErrorState resourceLabel="a próxima página do histórico" error={errorDetail} onRetry={() => { void onRetry(); }} compact />
      )}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            data-testid="button-load-more-outbound-history"
            variant="outline"
            onClick={onLoadMore}
            disabled={fetching}
          >
            {fetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Carregar mais mensagens
          </Button>
        </div>
      )}
    </>
  );
}